import { config } from "../../../package.json";
import { AiClient } from "../ai/ai-client";
import { getTemplate, renderPrompt } from "../ai/prompts";
import { ApiProfile, getActiveProfile } from "../ai/profiles";
import {
  addTask,
  createTaskItems,
  getItemTitle,
  type TaskItemResult,
  type TaskStatus,
  updateTask,
} from "../tasks/task-store";

const EXTRA_FIELD = "ZotWanglele-Translated-Title";
const EXTRA_PATTERN = new RegExp(`^${EXTRA_FIELD}:\\s*(.*)$`, "im");

let registeredColumnKey: string | null = null;

export interface TitleTranslationResult {
  ok: boolean;
  message: string;
  translatedTitle?: string;
}

export function getTranslatedTitleFromExtra(extra: string): string {
  return EXTRA_PATTERN.exec(extra)?.[1]?.trim() ?? "";
}

export function setTranslatedTitleInExtra(
  extra: string,
  translatedTitle: string,
): string {
  const normalized = translatedTitle.replace(/\s+/g, " ").trim();
  const line = `${EXTRA_FIELD}: ${normalized}`;
  if (EXTRA_PATTERN.test(extra)) {
    return extra.replace(EXTRA_PATTERN, line).trim();
  }
  return [extra.trim(), line].filter(Boolean).join("\n");
}

export function cleanTranslatedTitle(content: string): string {
  let value = content.trim();
  value = value.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "");
  value = value.replace(/^(?:翻译结果|中文标题|译文)\s*[:：]\s*/i, "");
  value = value.replace(/^[“"']|[”"']$/g, "");
  return value.replace(/\s+/g, " ").trim();
}

export async function translateItemTitle(
  item: Zotero.Item,
): Promise<TitleTranslationResult> {
  if (!item?.isRegularItem?.()) {
    return { ok: false, message: "请选择常规文献条目" };
  }
  const title = ((item.getField("title") as string) || "").trim();
  if (!title) return { ok: false, message: "条目标题为空" };

  const profile = getActiveProfile();
  const profileError = validateProfile(profile);
  if (profileError) return { ok: false, message: profileError };

  const template = getTemplate("translate-title");
  if (!template) return { ok: false, message: "标题翻译模板缺失" };
  const client = createClient(profile!);
  let response;
  try {
    response = await client.chat([
      { role: "system", content: template.systemPrompt },
      {
        role: "user",
        content: renderPrompt(template.userPrompt, { title }),
      },
    ]);
  } catch (error: any) {
    return {
      ok: false,
      message: `AI 调用失败：${error?.message ?? String(error)}`,
    };
  }

  const translatedTitle = cleanTranslatedTitle(response.content);
  if (!translatedTitle) return { ok: false, message: "AI 返回内容为空" };

  const extra = (item.getField("extra") as string) || "";
  item.setField("extra", setTranslatedTitleInExtra(extra, translatedTitle));
  await item.saveTx();
  Zotero.ItemTreeManager.refreshColumns();
  return { ok: true, message: "标题译文已保存", translatedTitle };
}

export async function runTitleTranslationOnSelected(): Promise<void> {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
  const targets = items.filter((item) => item?.isRegularItem?.());
  if (targets.length === 0) {
    new ztoolkit.ProgressWindow("ZotWanglele 标题翻译")
      .createLine({
        text: "请在条目列表中选择文献",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(4000);
    return;
  }

  const itemResults = createTaskItems(targets);
  const task = addTask({
    kind: "title-translation",
    title: "翻译标题",
    itemIds: targets.map((item) => item.id),
    itemTitles: itemResults.map((item) => item.title),
    itemResults,
    startedAt: Date.now(),
    summary: `共 ${targets.length} 篇文献`,
    details: [{ label: "写入位置", value: "条目 Extra 的标题译文" }],
  });
  updateTask(task.id, {
    status: "running",
    step: "准备翻译标题",
    progress: 2,
  });

  const progress = new ztoolkit.ProgressWindow("ZotWanglele 标题翻译", {
    closeTime: -1,
  })
    .createLine({
      text: `将翻译 ${targets.length} 个标题`,
      type: "default",
      progress: 0,
    })
    .show();

  let success = 0;
  const errors: string[] = [];
  for (let index = 0; index < targets.length; index++) {
    const item = targets[index];
    const title = getItemTitle(item);
    itemResults[index] = { ...itemResults[index], status: "running" };
    updateTask(task.id, {
      step: `正在翻译 ${index + 1}/${targets.length}：${title}`,
      progress: Math.round((index / targets.length) * 100),
      itemResults: itemResults.slice(),
    });
    progress.changeLine({
      text: `[${index + 1}/${targets.length}] ${title.slice(0, 60)}`,
      progress: Math.round((index / targets.length) * 100),
    });

    let result: TitleTranslationResult;
    try {
      result = await translateItemTitle(item);
    } catch (error: any) {
      result = {
        ok: false,
        message: `标题翻译异常：${error?.message ?? String(error)}`,
      };
    }

    if (result.ok) {
      success++;
      itemResults[index] = {
        ...itemResults[index],
        status: "success",
        detail: result.translatedTitle || result.message,
      };
    } else {
      errors.push(`${title}: ${result.message}`);
      itemResults[index] = {
        ...itemResults[index],
        status: "failed",
        detail: result.message,
      };
    }
    updateTask(task.id, { itemResults: itemResults.slice() });
  }

  const failed = targets.length - success;
  const detail = errors.length > 0 ? `；${errors[0]}` : "";
  const status: TaskStatus =
    failed === 0 ? "success" : success === 0 ? "failed" : "partial";
  const summary = `成功 ${success} 项，失败 ${failed} 项`;
  updateTask(task.id, {
    status,
    step: "完成",
    progress: 100,
    summary,
    itemResults: itemResults.slice(),
    error: status === "failed" ? errors.join("\n") : undefined,
    finishedAt: Date.now(),
  });
  progress.changeLine({
    text: `完成 ${success} 项，失败 ${failed} 项${detail}`,
    type: failed === 0 ? "success" : "default",
    progress: 100,
  });
  progress.startCloseTimer(failed === 0 ? 5000 : 9000);
}

export async function registerTitleTranslationColumn(): Promise<void> {
  if (
    registeredColumnKey &&
    Zotero.ItemTreeManager.isCustomColumn(registeredColumnKey)
  ) {
    return;
  }

  if (!Zotero.ItemTreeManager?.registerColumn) {
    ztoolkit.log("[TitleTranslation] custom column API unavailable");
    return;
  }

  const result = await Zotero.ItemTreeManager.registerColumn({
    dataKey: "translatedTitle",
    label: Zotero.locale?.startsWith("zh") ? "标题译文" : "Translated Title",
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    flex: 1,
    minWidth: 120,
    showInColumnPicker: true,
    dataProvider: (item) =>
      getTranslatedTitleFromExtra((item.getField("extra") as string) || ""),
    zoteroPersist: ["width", "hidden", "sortDirection"],
  });
  if (result) registeredColumnKey = result;
}

export function unregisterTitleTranslationColumn(): void {
  if (!registeredColumnKey) return;
  if (Zotero.ItemTreeManager?.unregisterColumn) {
    Zotero.ItemTreeManager.unregisterColumn(registeredColumnKey);
  }
  registeredColumnKey = null;
}

function validateProfile(profile: ApiProfile | null): string | null {
  if (!profile) return "请在偏好设置中选择 AI 配置档";
  if (!profile.baseUrl || !profile.apiKey || !profile.model) {
    return `AI 配置档“${profile.name}”的信息尚未填写完整`;
  }
  return null;
}

function createClient(profile: ApiProfile): AiClient {
  return new AiClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    format: profile.format,
    temperature: Math.min(profile.temperature / 100, 0.3),
    maxTokens: Math.min(profile.maxTokens, 512),
  });
}
