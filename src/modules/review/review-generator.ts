import { AiClient, ChatMessage } from "../ai/ai-client";
import { getActiveTemplate, renderPrompt } from "../ai/prompts";
import { ApiProfile, getActiveProfile, getModelLabel } from "../ai/profiles";
import { markdownToHtmlMinimal } from "../reader/note-generator";
import { getItemMeta, getPdfText } from "../reader/pdf-extractor";
import {
  addTask,
  createTaskItems,
  type TaskItemResult,
  updateTask,
} from "../tasks/task-store";

const MAX_REVIEW_ITEMS = 30;

export interface ReviewResult {
  ok: boolean;
  message: string;
  noteId?: number;
}

export interface ReviewOptions {
  collectionId?: number;
  onProgress?: (text: string) => void;
}

export async function generateLiteratureReview(
  items: Zotero.Item[],
  options: ReviewOptions = {},
): Promise<ReviewResult> {
  const targets = items.filter((item) => item?.isRegularItem?.());
  if (targets.length < 2) {
    return { ok: false, message: "请选择至少两篇常规文献条目" };
  }
  if (targets.length > MAX_REVIEW_ITEMS) {
    return {
      ok: false,
      message: `单次综述最多支持 ${MAX_REVIEW_ITEMS} 篇文献`,
    };
  }

  const profile = getActiveProfile();
  const profileError = validateProfile(profile);
  if (profileError) return { ok: false, message: profileError };

  const template = getActiveTemplate("literature-review");
  if (!template) return { ok: false, message: "文献综述模板缺失" };

  options.onProgress?.("正在整理题录与摘要");
  const sources: string[] = [];
  for (let index = 0; index < targets.length; index++) {
    const item = targets[index];
    const meta = getItemMeta(item);
    let abstract = meta.abstract.trim();
    if (!abstract) {
      abstract = (await getPdfText(item, 8_000)).trim();
    }
    sources.push(
      formatReviewSource(index + 1, {
        ...meta,
        abstract: abstract || "未提供摘要或索引文本",
      }),
    );
    options.onProgress?.(`已整理 ${index + 1}/${targets.length} 篇文献`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: template.systemPrompt },
    {
      role: "user",
      content: renderPrompt(template.userPrompt, {
        abstract: sources.join("\n\n---\n\n"),
      }),
    },
  ];

  options.onProgress?.(`正在调用 ${getModelLabel(profile!)}`);
  const client = createClient(profile!);
  let response;
  try {
    response = await client.chat(messages);
  } catch (error: any) {
    return {
      ok: false,
      message: `AI 调用失败：${error?.message ?? String(error)}`,
    };
  }

  const content = response.content.trim();
  if (!content) return { ok: false, message: "AI 返回内容为空" };

  options.onProgress?.("正在保存综述笔记");
  const noteId = await saveReviewNote(targets, content, options.collectionId);
  return {
    ok: true,
    noteId,
    message: `已生成包含 ${targets.length} 篇文献的综述笔记`,
  };
}

export async function runLiteratureReviewOnSelected(): Promise<void> {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
  const collection = pane?.getSelectedCollection?.() as
    | Zotero.Collection
    | undefined;
  const targets = items.filter((item) => item?.isRegularItem?.());
  const canCreateTask =
    targets.length >= 2 && targets.length <= MAX_REVIEW_ITEMS;
  const itemResults = canCreateTask ? createTaskItems(targets) : [];
  const task = canCreateTask
    ? addTask({
        kind: "literature-review",
        title: "生成文献综述",
        itemIds: targets.map((item) => item.id),
        itemTitles: itemResults.map((item) => item.title),
        itemResults,
        startedAt: Date.now(),
        summary: `纳入 ${targets.length} 篇文献`,
        details: [{ label: "输出", value: "独立综述笔记" }],
      })
    : null;
  if (task) {
    updateTask(task.id, {
      status: "running",
      step: "正在准备文献信息",
      progress: 5,
    });
  }

  const progress = new ztoolkit.ProgressWindow("ZotWanglele 文献综述", {
    closeTime: -1,
  })
    .createLine({ text: "正在准备文献信息", type: "default", progress: 0 })
    .show();

  let reportedProgress = 5;
  let result: ReviewResult;
  try {
    result = await generateLiteratureReview(items, {
      collectionId: collection?.id,
      onProgress: (text) => {
        progress.changeLine({ text });
        if (task) {
          reportedProgress = Math.min(reportedProgress + 20, 90);
          updateTask(task.id, {
            step: text,
            progress: reportedProgress,
            lastLog: text,
          });
        }
      },
    });
  } catch (error: any) {
    result = {
      ok: false,
      message: `生成综述失败：${error?.message ?? String(error)}`,
    };
  }

  if (task) {
    const finalItems: TaskItemResult[] = itemResults.map((item) => ({
      ...item,
      status: result.ok ? "success" : "failed",
      detail: result.ok ? "已纳入综述来源" : result.message,
    }));
    updateTask(task.id, {
      status: result.ok ? "success" : "failed",
      step: result.ok ? "完成" : "生成失败",
      progress: 100,
      summary: result.message,
      itemResults: finalItems,
      error: result.ok ? undefined : result.message,
      finishedAt: Date.now(),
      details: [
        {
          label: "输出",
          value: result.noteId ? `笔记 ${result.noteId}` : "未生成",
        },
      ],
    });
  }

  progress.changeLine({
    text: result.message,
    type: result.ok ? "success" : "fail",
    progress: 100,
  });
  progress.startCloseTimer(result.ok ? 5000 : 8000);

  if (result.ok && result.noteId) {
    await pane?.selectItem?.(result.noteId);
  }
}

export function formatReviewSource(
  index: number,
  meta: {
    title: string;
    authors: string;
    year: string;
    abstract: string;
    doi: string;
  },
): string {
  return [
    `## 文献 ${index}`,
    `标题：${meta.title || "未填写"}`,
    `作者：${meta.authors || "未填写"}`,
    `年份：${meta.year || "未填写"}`,
    meta.doi ? `DOI：${meta.doi}` : "",
    `摘要或正文节选：\n${meta.abstract}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function validateProfile(profile: ApiProfile | null): string | null {
  if (!profile) return "请在偏好设置中选择 AI 配置档";
  if (!profile.baseUrl || !profile.apiKey || !profile.model) {
    return `AI 配置档“${getModelLabel(profile)}”的信息尚未填写完整`;
  }
  return null;
}

function createClient(profile: ApiProfile): AiClient {
  return new AiClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    format: profile.format,
    temperature: profile.temperature / 100,
    maxTokens: profile.maxTokens,
  });
}

async function saveReviewNote(
  sources: Zotero.Item[],
  markdown: string,
  collectionId?: number,
): Promise<number> {
  const note = new Zotero.Item("note");
  note.libraryID = sources[0].libraryID;
  if (collectionId) note.addToCollection(collectionId);
  note.setNote(
    `<h1>ZotWanglele · 文献综述</h1>\n${markdownToHtmlMinimal(markdown)}`,
  );
  const saved = await note.saveTx();
  return typeof saved === "number" ? saved : note.id;
}
