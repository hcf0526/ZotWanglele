/**
 * 仪表盘 "翻译任务" tab 的渲染器。
 *
 * 订阅 task-store 的变更，把任务列表渲染为 HTML。
 * 当仪表盘窗口关闭时，调用 unmount 解订。
 */

import {
  TranslateTask,
  TaskStatus,
  clearFinishedTasks,
  subscribe,
} from "../translate/task-store";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待开始",
  running: "运行中",
  success: "成功",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "#888",
  running: "#0a84ff",
  success: "#1a8917",
  failed: "#c0392b",
  cancelled: "#888",
};

/**
 * 在仪表盘窗口里挂载翻译任务面板。返回卸载函数。
 */
export function mountQueuePanel(win: Window): () => void {
  const doc = win.document;
  const root = doc.getElementById("zotwanglele-queue-root");
  const listEl = doc.getElementById("zotwanglele-queue-list");
  const summaryEl = doc.getElementById("zotwanglele-queue-summary");
  const clearBtn = doc.getElementById("zotwanglele-queue-clear");
  if (!root || !listEl || !summaryEl) {
    ztoolkit.log("[QueuePanel] missing dom elements, abort mount");
    return () => undefined;
  }

  const onClear = () => {
    clearFinishedTasks();
  };
  clearBtn?.addEventListener("click", onClear);

  const unsubscribe = subscribe((tasks) => {
    render(win, listEl as HTMLElement, summaryEl as HTMLElement, tasks);
  });

  return () => {
    unsubscribe();
    clearBtn?.removeEventListener("click", onClear);
  };
}

// ============================================================
// 渲染
// ============================================================

function render(
  win: Window,
  listEl: HTMLElement,
  summaryEl: HTMLElement,
  tasks: TranslateTask[],
): void {
  const total = tasks.length;
  const running = tasks.filter((t) => t.status === "running").length;
  const success = tasks.filter((t) => t.status === "success").length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  if (total === 0) {
    summaryEl.textContent = "暂无任务";
    listEl.innerHTML = `<p style="color: #888;">在右键菜单选 "ZotWanglele · 翻译 PDF" 发起任务后，这里会显示进度。</p>`;
    return;
  }

  summaryEl.textContent = `共 ${total} 个：进行 ${running} / 成功 ${success} / 失败 ${failed}`;

  // 倒序：最新的在最上
  const sorted = [...tasks].reverse();
  listEl.replaceChildren(
    ...sorted.map((task) => renderTaskElement(win.document, task)),
  );
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

function renderTaskElement(doc: Document, t: TranslateTask): HTMLElement {
  const color = STATUS_COLOR[t.status];
  const root = createElement(doc, "div", {
    background: "white",
    border: "1px solid #e0e0e0",
    "border-radius": "6px",
    padding: "8px 10px",
    "margin-bottom": "6px",
    "min-width": "0",
  });

  const header = createElement(doc, "div", {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    "min-width": "0",
  });
  header.append(
    createElement(
      doc,
      "strong",
      {
        flex: "1",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
        "min-width": "0",
      },
      t.title,
    ),
    createElement(
      doc,
      "span",
      {
        color,
        "font-size": "12px",
        padding: "1px 8px",
        border: `1px solid ${color}`,
        "border-radius": "3px",
        "flex-shrink": "0",
      },
      STATUS_LABEL[t.status],
    ),
    createElement(
      doc,
      "span",
      {
        color: "#888",
        "font-size": "12px",
        "flex-shrink": "0",
      },
      `${t.progress}%`,
    ),
  );

  const meta = createElement(doc, "div", {
    "font-size": "12px",
    color: "#888",
    "line-height": "1.45",
    margin: "2px 0 4px",
    "overflow-wrap": "anywhere",
    "word-break": "break-word",
  });
  meta.append(
    createElement(doc, "div", {}, `引擎：${t.engine}`),
    createElement(doc, "div", {}, `输出：${t.outputs.join("+")}`),
    createElement(doc, "div", {}, `服务：${t.service}`),
    createElement(doc, "div", {}, `目标：${t.langOut}`),
  );

  const progressBar = createElement(doc, "div", {
    background: "#eee",
    "border-radius": "4px",
    height: "6px",
    overflow: "hidden",
  });
  progressBar.append(
    createElement(doc, "div", {
      background: color,
      height: "100%",
      width: `${t.progress}%`,
      transition: "width .2s",
    }),
  );

  root.append(
    header,
    meta,
    progressBar,
    createElement(
      doc,
      "div",
      {
        color: "#555",
        "font-size": "12px",
        "line-height": "1.45",
        "margin-top": "4px",
        "white-space": "pre-wrap",
        "overflow-wrap": "anywhere",
        "word-break": "break-word",
      },
      t.step,
    ),
  );

  if (t.lastLog) {
    root.append(
      createElement(
        doc,
        "div",
        {
          color: "#555",
          "font-size": "11px",
          "line-height": "1.45",
          "font-family": "monospace",
          "margin-top": "2px",
          "white-space": "pre-wrap",
          "overflow-wrap": "anywhere",
          "word-break": "break-word",
          "max-height": "120px",
          overflow: "auto",
        },
        t.lastLog,
      ),
    );
  }

  if (t.error) {
    root.append(
      createElement(
        doc,
        "div",
        {
          color: "#c0392b",
          "font-size": "12px",
          "line-height": "1.45",
          "margin-top": "4px",
          "white-space": "pre-wrap",
          "overflow-wrap": "anywhere",
          "word-break": "break-word",
          "max-height": "160px",
          overflow: "auto",
          background: "#fff0f0",
          padding: "4px 6px",
          "border-radius": "3px",
        },
        t.error,
      ),
    );
  }

  if (t.outputFiles.length > 0) {
    const files = createElement(
      doc,
      "div",
      {
        "font-size": "12px",
        color: "#555",
        "line-height": "1.45",
        margin: "4px 0 0",
        "overflow-wrap": "anywhere",
        "word-break": "break-word",
      },
      "输出文件：",
    );
    for (const file of t.outputFiles) {
      files.append(
        createElement(
          doc,
          "div",
          {
            display: "block",
            background: "#eef",
            padding: "1px 6px",
            "border-radius": "3px",
            margin: "2px 0 0",
            "overflow-wrap": "anywhere",
            "word-break": "break-word",
          },
          `${file.kind}：${basename(file.path)}`,
        ),
      );
    }
    root.append(files);
  }

  return root;
}

function createElement(
  doc: Document,
  tag: string,
  styles: Record<string, string>,
  text?: string,
): HTMLElement {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElement;
  const style = Object.entries(styles)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  if (style) node.setAttribute("style", style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTask(_win: Window, t: TranslateTask): string {
  const color = STATUS_COLOR[t.status];
  const statusLabel = STATUS_LABEL[t.status];
  const progressBar = `
    <div style="background: #eee; border-radius: 4px; height: 6px; overflow: hidden;">
      <div style="background: ${color}; height: 100%; width: ${t.progress}%; transition: width .2s;"></div>
    </div>`;

  const meta = `
    <div>引擎：${escapeHtml(t.engine)}</div>
    <div>输出：${escapeHtml(t.outputs.join("+"))}</div>
    <div>服务：${escapeHtml(t.service)}</div>
    <div>目标：${escapeHtml(t.langOut)}</div>`;

  const errorBlock = t.error
    ? `<div style="color: #c0392b; font-size: 12px; line-height: 1.45; margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-height: 160px; overflow: auto; background: #fff0f0; padding: 4px 6px; border-radius: 3px;">${escapeHtml(t.error)}</div>`
    : "";

  const lastLog = t.lastLog
    ? `<div style="color: #555; font-size: 11px; line-height: 1.45; font-family: monospace; margin-top: 2px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-height: 120px; overflow: auto;">${escapeHtml(t.lastLog)}</div>`
    : "";

  const filesBlock =
    t.outputFiles.length > 0
      ? `<div style="font-size: 12px; color: #555; line-height: 1.45; margin-top: 4px; overflow-wrap: anywhere; word-break: break-word;">输出文件：${t.outputFiles
          .map(
            (f) =>
              `<div style="display: block; background: #eef; padding: 1px 6px; border-radius: 3px; margin-top: 2px; overflow-wrap: anywhere; word-break: break-word;">${f.kind}：${escapeHtml(basename(f.path))}</div>`,
          )
          .join("")}</div>`
      : "";

  return `
    <div style="background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <strong style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.title)}</strong>
        <span style="color: ${color}; font-size: 12px; padding: 1px 8px; border: 1px solid ${color}; border-radius: 3px;">${statusLabel}</span>
        <span style="color: #888; font-size: 12px;">${t.progress}%</span>
      </div>
      <div style="font-size: 12px; color: #888; margin: 2px 0 4px; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">${meta}</div>
      ${progressBar}
      <div style="color: #555; font-size: 12px; line-height: 1.45; margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(t.step)}</div>
      ${lastLog}
      ${errorBlock}
      ${filesBlock}
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function basename(p: string): string {
  const m = p.match(/[\\/]([^\\/]+)$/);
  return m ? m[1] : p;
}
