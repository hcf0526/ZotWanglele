import { getAllTemplates, getCustomTemplates } from "../ai/prompts";
import {
  getActiveProfile,
  getSupplierName,
  subscribeProfiles,
} from "../ai/profiles";
import { getTasks, subscribe } from "../translate/task-store";
import { getTranslatedTitleFromExtra } from "../title-translate/title-translation";

export function mountOverviewPanel(win: Window): () => void {
  const doc = win.document;

  const render = () => {
    const isChinese = Zotero.locale?.startsWith("zh");
    const profile = getActiveProfile();
    setText(
      doc,
      "zwl-overview-profile",
      (profile && getSupplierName(profile)) ||
        (isChinese ? "尚未选择" : "Not selected"),
    );
    setText(
      doc,
      "zwl-overview-model",
      profile?.model || (isChinese ? "尚未配置模型" : "Model not configured"),
    );
    setText(doc, "zwl-overview-prompts", String(getAllTemplates().length));
    setText(
      doc,
      "zwl-overview-custom-prompts",
      isChinese
        ? `${getCustomTemplates().length} 个自定义模板`
        : `${getCustomTemplates().length} custom`,
    );

    const tasks = getTasks();
    const activeTasks = tasks.filter(
      (task) => task.status === "pending" || task.status === "running",
    ).length;
    setText(doc, "zwl-overview-tasks", String(activeTasks));
    setText(
      doc,
      "zwl-overview-task-total",
      isChinese ? `${tasks.length} 个任务记录` : `${tasks.length} task records`,
    );

    const pane = (Zotero as any).getActiveZoteroPane?.();
    const selected: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
    const regular = selected.filter((item) => item?.isRegularItem?.());
    const translated = regular.filter((item) =>
      getTranslatedTitleFromExtra(
        ((item.getField("extra") as string) || "").trim(),
      ),
    ).length;
    setText(doc, "zwl-overview-titles", `${translated}/${regular.length}`);
    setText(
      doc,
      "zwl-overview-title-caption",
      isChinese ? "所选条目的译文覆盖" : "Selected items with translations",
    );
  };

  win.addEventListener("zotwanglele-prompts-changed", render);
  const unsubscribe = subscribe(render);
  const unsubscribeProfiles = subscribeProfiles(render);
  render();

  return () => {
    win.removeEventListener("zotwanglele-prompts-changed", render);
    unsubscribe();
    unsubscribeProfiles();
  };
}

function setText(doc: Document, id: string, value: string): void {
  const element = doc.getElementById(id);
  if (element) element.textContent = value;
}
