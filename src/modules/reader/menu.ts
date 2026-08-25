/**
 * 注册 Zotero 条目右键菜单：合并到一个 ZotWanglele 子菜单下。
 *
 * 注意：ztoolkit 的 MenuManager 在内部 genMenuElement 中是通过
 * `menuitemOption.children` 来递归生成子项的，而公开类型字段叫
 * `subElementOptions`。这是 toolkit 的一个 bug，所以我们直接传 `children`。
 */
import { config } from "../../../package.json";
import { FULL_READ_TEMPLATE_ID, QUICK_SUMMARY_TEMPLATE_ID } from "./prompts";
import { getBuiltinTemplateName } from "../ai/prompts";
import { generateNoteForItem } from "./note-generator";
import { startTranslate } from "../translate/translator";
import { openDashboard } from "../dashboard/dashboard";
import { runLiteratureReviewOnSelected } from "../review/review-generator";
import { runTitleTranslationOnSelected } from "../title-translate/title-translation";
import {
  applyMetadataFields,
  fetchAndCompareMetadata,
  openMetadataComparisonDialog,
  openMetadataResultDialog,
  type MetadataItemResult,
} from "../metadata";

const ICON = `chrome://${config.addonRef}/content/icons/favicon.png`;
const FULL_READ_LABEL =
  getBuiltinTemplateName(FULL_READ_TEMPLATE_ID) ?? "AI 精读";
const QUICK_SUMMARY_LABEL =
  getBuiltinTemplateName(QUICK_SUMMARY_TEMPLATE_ID) ?? "快速摘要";

export function registerReaderMenu() {
  ztoolkit.log("[ReaderMenu] registering item context menu...");
  try {
    ztoolkit.Menu.register("item", {
      tag: "menu",
      id: "zotwanglele-itemmenu",
      label: "ZotWanglele",
      icon: ICON,
      popupId: "zotwanglele-itemmenu-popup",
      // MenuManager 的运行时代码读取 children 字段。
      children: [
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-fullread",
          label: FULL_READ_LABEL,
          commandListener: () => {
            ztoolkit.log("[ReaderMenu] fullread click");
            runOnSelected(FULL_READ_TEMPLATE_ID).catch((e) =>
              ztoolkit.log("[ReaderMenu] fullread error:", e),
            );
          },
        },
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-summary",
          label: QUICK_SUMMARY_LABEL,
          commandListener: () => {
            ztoolkit.log("[ReaderMenu] summary click");
            runOnSelected(QUICK_SUMMARY_TEMPLATE_ID).catch((e) =>
              ztoolkit.log("[ReaderMenu] summary error:", e),
            );
          },
        },
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-review",
          label: "生成文献综述",
          commandListener: () => {
            runLiteratureReviewOnSelected().catch((e) =>
              ztoolkit.log("[ReaderMenu] review error:", e),
            );
          },
        },
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-title-translate",
          label: "翻译标题",
          commandListener: () => {
            runTitleTranslationOnSelected().catch((e) =>
              ztoolkit.log("[ReaderMenu] title translation error:", e),
            );
          },
        },
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-metadata-update",
          label: "更新文献信息",
          commandListener: () => {
            runMetadataUpdateOnSelected().catch((e) =>
              ztoolkit.log("[ReaderMenu] metadata update error:", e),
            );
          },
        },
        { tag: "menuseparator" },
        {
          tag: "menuitem",
          id: "zotwanglele-itemmenu-translate",
          label: "翻译 PDF",
          commandListener: () => {
            ztoolkit.log("[ReaderMenu] translate click");
            runTranslateOnSelected().catch((e) =>
              ztoolkit.log("[ReaderMenu] translate error:", e),
            );
          },
        },
      ],
    } as any);
    ztoolkit.log("[ReaderMenu] registered ZotWanglele submenu");
  } catch (e) {
    ztoolkit.log("[ReaderMenu] register failed:", e);
  }
}

/**
 * 对所有选中的常规条目，依次生成笔记。串行处理，避免并发打爆 API。
 */
async function runOnSelected(templateId: string) {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
  const targets = items.filter(
    (it) => it && it.isRegularItem && it.isRegularItem(),
  );

  if (targets.length === 0) {
    new ztoolkit.ProgressWindow("ZotWanglele")
      .createLine({
        text: "请先在条目列表里选中一篇或多篇文献",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(3000);
    return;
  }

  const popup = new ztoolkit.ProgressWindow("ZotWanglele", { closeTime: -1 })
    .createLine({
      text: `准备处理 ${targets.length} 篇文献…`,
      type: "default",
      progress: 0,
    })
    .show();

  let success = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const title = (item.getField("title") as string) || `条目 ${item.id}`;
    const prefix = `[${i + 1}/${targets.length}] `;
    popup.changeLine({
      text: `${prefix}${title.slice(0, 50)} — 准备…`,
      progress: Math.round((i / targets.length) * 100),
    });

    try {
      const r = await generateNoteForItem(item, {
        templateId,
        onProgress: (s) => popup.changeLine({ text: `${prefix}${s}` }),
      });
      if (r.ok) {
        success++;
        popup.changeLine({ text: `${prefix}✅ ${r.message}`, type: "success" });
      } else {
        failed++;
        popup.changeLine({ text: `${prefix}❌ ${r.message}`, type: "fail" });
      }
    } catch (e: any) {
      failed++;
      popup.changeLine({
        text: `${prefix}❌ 异常：${e?.message ?? String(e)}`,
        type: "fail",
      });
    }
  }

  popup.changeLine({
    text: `完成：成功 ${success} / 失败 ${failed}`,
    type: failed === 0 ? "success" : "default",
    progress: 100,
  });
  popup.startCloseTimer(8000);
}

/**
 * 串行查询选中的文献。每个条目都在对比窗口中单独选择要写入的字段，
 * 这样批量操作仍然保留字段级确认能力。处理完成后弹出结果汇总窗口，
 * 展示每个条目的成功 / 失败 / 跳过 / 无变化状态及具体信息。
 */
async function runMetadataUpdateOnSelected() {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
  const targets = items.filter(
    (item) => item && item.isRegularItem && item.isRegularItem(),
  );

  if (targets.length === 0) {
    new ztoolkit.ProgressWindow("ZotWanglele 元数据")
      .createLine({
        text: "请先在条目列表里选中一篇或多篇文献",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(3000);
    return;
  }

  const progress = new ztoolkit.ProgressWindow("ZotWanglele 元数据", {
    closeTime: -1,
  })
    .createLine({
      text: `准备查询 ${targets.length} 篇文献…`,
      type: "default",
      progress: 0,
    })
    .show();
  const parentWin = (pane?.document?.defaultView ??
    Zotero.getMainWindow()) as Window;

  const results: MetadataItemResult[] = [];
  let queried = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 0; index < targets.length; index++) {
    const item = targets[index];
    const title = (item.getField("title") as string) || `条目 ${item.id}`;
    const prefix = `[${index + 1}/${targets.length}] `;
    progress.changeLine({
      text: `${prefix}${title.slice(0, 56)} — 查询中…`,
      progress: Math.round((index / targets.length) * 100),
    });

    const fetched = await fetchAndCompareMetadata(item, parentWin, false);
    if (!fetched.ok) {
      if (fetched.needsCandidateSelection) {
        skipped++;
        progress.changeLine({ text: `${prefix}等待选择记录`, type: "default" });
        results.push({
          title,
          status: "pending",
          detail: fetched.message,
          selectable: true,
          targetIndex: index,
        });
        continue;
      }
      failed++;
      progress.changeLine({
        text: `${prefix}查询失败`,
        type: "fail",
      });
      results.push({
        title,
        status: "failed",
        detail: `查询失败：${fetched.message}`,
      });
      continue;
    }

    queried++;
    const diffs = fetched.diffs ?? [];
    if (diffs.length === 0) {
      unchanged++;
      progress.changeLine({ text: `${prefix}没有字段变化`, type: "success" });
      results.push({
        title,
        status: "unchanged",
        detail: "Crossref 元数据与当前条目一致，没有字段需要更新。",
      });
      continue;
    }

    const selected = openMetadataComparisonDialog(parentWin, title, diffs);
    if (selected === null) {
      skipped++;
      progress.changeLine({ text: `${prefix}已跳过`, type: "default" });
      results.push({
        title,
        status: "skipped",
        detail: "取消更新，未做任何修改。",
      });
      continue;
    }
    if (selected.length === 0 || !fetched.metadata) {
      skipped++;
      progress.changeLine({ text: `${prefix}未选择字段`, type: "default" });
      results.push({
        title,
        status: "skipped",
        detail: "未选择任何字段，未写入。",
      });
      continue;
    }

    try {
      const applied = await applyMetadataFields(
        item,
        fetched.metadata,
        selected,
      );
      if (applied.applied.length > 0) {
        updated++;
        const fieldNames = applied.applied
          .map((f) => {
            return (
              {
                title: "标题",
                authors: "作者",
                abstractNote: "摘要",
                DOI: "DOI",
                date: "日期",
              }[f] ?? f
            );
          })
          .join("、");
        progress.changeLine({
          text: `${prefix}已更新 ${applied.applied.length} 个字段`,
          type: "success",
        });
        results.push({
          title,
          status: "success",
          detail: `已写入字段：${fieldNames}。`,
        });
      } else {
        skipped++;
        progress.changeLine({ text: `${prefix}未写入字段`, type: "default" });
        results.push({
          title,
          status: "skipped",
          detail: "所选字段无可写入内容，未修改。",
        });
      }
    } catch (error: any) {
      failed++;
      progress.changeLine({
        text: `${prefix}保存失败`,
        type: "fail",
      });
      results.push({
        title,
        status: "failed",
        detail: `保存失败：${error?.message ?? String(error)}`,
      });
    }
  }

  progress.changeLine({
    text: `完成：查询 ${queried}，更新 ${updated}，无变化 ${unchanged}，跳过 ${skipped}，失败 ${failed}`,
    type: failed === 0 ? "success" : "default",
    progress: 100,
  });
  progress.startCloseTimer(500);

  // 先展示全部初始结果；无 DOI 条目由用户点击“选择”后才进入候选窗口。
  let selectedResultIndex = openMetadataResultDialog(parentWin, results);
  while (selectedResultIndex !== null) {
    const pending = results[selectedResultIndex];
    const targetIndex = pending?.targetIndex;
    if (
      pending?.status !== "pending" ||
      targetIndex === undefined ||
      !targets[targetIndex]
    ) {
      break;
    }
    results[selectedResultIndex] = await processNoDoiMetadataItem(
      targets[targetIndex],
      parentWin,
    );
    selectedResultIndex = openMetadataResultDialog(parentWin, results);
  }
}

async function processNoDoiMetadataItem(
  item: Zotero.Item,
  parentWin: Window,
): Promise<MetadataItemResult> {
  const title = (item.getField("title") as string) || `条目 ${item.id}`;
  const fetched = await fetchAndCompareMetadata(item, parentWin, true);
  if (!fetched.ok) {
    return {
      title,
      status: fetched.message === "已取消候选记录选择" ? "skipped" : "failed",
      detail: fetched.message,
    };
  }

  const diffs = fetched.diffs ?? [];
  if (diffs.length === 0) {
    return {
      title,
      status: "unchanged",
      detail: "Crossref 元数据与当前条目一致，没有字段需要更新。",
    };
  }

  const selected = openMetadataComparisonDialog(parentWin, title, diffs);
  if (selected === null) {
    return { title, status: "skipped", detail: "取消更新，未做任何修改。" };
  }
  if (selected.length === 0 || !fetched.metadata) {
    return { title, status: "skipped", detail: "未选择任何字段，未写入。" };
  }

  try {
    const applied = await applyMetadataFields(item, fetched.metadata, selected);
    if (applied.applied.length === 0) {
      return {
        title,
        status: "skipped",
        detail: "所选字段无可写入内容，未修改。",
      };
    }
    const labels: Record<string, string> = {
      title: "标题",
      authors: "作者",
      abstractNote: "摘要",
      DOI: "DOI",
      date: "日期",
    };
    return {
      title,
      status: "success",
      detail: `已写入字段：${applied.applied.map((field) => labels[field] ?? field).join("、")}。`,
    };
  } catch (error: any) {
    return {
      title,
      status: "failed",
      detail: `保存失败：${error?.message ?? String(error)}`,
    };
  }
}

/**
 * 对所有选中条目发起 PDF 翻译。每个条目作为一个独立任务进入队列，
 * 实际执行/进度展示交给仪表盘"翻译任务"tab。
 */
async function runTranslateOnSelected() {
  const pane = (Zotero as any).getActiveZoteroPane?.();
  const items: Zotero.Item[] = pane?.getSelectedItems?.() ?? [];
  const targets = items.filter(
    (it) => it && it.isRegularItem && it.isRegularItem(),
  );

  if (targets.length === 0) {
    new ztoolkit.ProgressWindow("ZotWanglele 翻译")
      .createLine({
        text: "请先在条目列表里选中一篇或多篇文献",
        type: "fail",
        progress: 100,
      })
      .show()
      .startCloseTimer(3000);
    return;
  }

  let queued = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const item of targets) {
    const r = await startTranslate({ item });
    if (r.ok) {
      queued++;
    } else {
      skipped++;
      errors.push(
        `${(item.getField("title") as string) || "条目"}: ${r.error ?? "未知错误"}`,
      );
    }
  }

  // 用进度窗口提示用户已加入队列；详情让他们去仪表盘看
  const popup = new ztoolkit.ProgressWindow("ZotWanglele 翻译")
    .createLine({
      text: `已加入队列：${queued}，跳过 ${skipped}。点击查看进度。`,
      type: skipped === 0 ? "success" : "default",
      progress: 100,
    })
    .show();

  // 顺手把仪表盘打开并切到翻译任务 tab
  const win = pane?.document?.defaultView ?? Zotero.getMainWindow();
  openDashboard(win as Window, "queue");

  if (errors.length > 0) {
    ztoolkit.log("[ReaderMenu] translate skipped reasons:", errors.join(" | "));
  }
  popup.startCloseTimer(5000);
}
