import { getAllTemplates, getCustomTemplates } from "../ai/prompts";
import { getActiveProfile } from "../ai/profiles";
import { runLiteratureReviewOnSelected } from "../review/review-generator";
import { getTasks, subscribe } from "../translate/task-store";
import {
  getTranslatedTitleFromExtra,
  runTitleTranslationOnSelected,
} from "../title-translate/title-translation";

export function mountOverviewPanel(win: Window): () => void {
  const doc = win.document;
  const reviewButton = doc.getElementById("zwl-overview-review");
  const titleButton = doc.getElementById("zwl-overview-title-translate");

  const render = () => {
    const isChinese = Zotero.locale?.startsWith("zh");
    const profile = getActiveProfile();
    setText(
      doc,
      "zwl-overview-profile",
      profile?.name || (isChinese ? "尚未选择" : "Not selected"),
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

  const onReview = () => {
    runLiteratureReviewOnSelected().catch((error) =>
      ztoolkit.log("[Overview] review error:", error),
    );
  };
  const onTitleTranslation = () => {
    runTitleTranslationOnSelected().catch((error) =>
      ztoolkit.log("[Overview] title translation error:", error),
    );
  };

  reviewButton?.addEventListener("click", onReview);
  titleButton?.addEventListener("click", onTitleTranslation);
  win.addEventListener("zotwanglele-prompts-changed", render);
  const unsubscribe = subscribe(render);
  render();

  return () => {
    reviewButton?.removeEventListener("click", onReview);
    titleButton?.removeEventListener("click", onTitleTranslation);
    win.removeEventListener("zotwanglele-prompts-changed", render);
    unsubscribe();
  };
}

function setText(doc: Document, id: string, value: string): void {
  const element = doc.getElementById(id);
  if (element) element.textContent = value;
}
