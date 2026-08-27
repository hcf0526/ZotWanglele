import {
  clearFinishedTaskRecords,
  subscribe,
  type PdfTranslationTask,
  type TaskItemResult,
  type TaskItemStatus,
  type TaskRecord,
  type TaskRecordKind,
  type TaskStatus,
} from "../tasks/task-store";

interface TaskCopy {
  emptySummary: string;
  emptyDescription: string;
  target: string;
  started: string;
  finished: string;
  latestLog: string;
  error: string;
  outputFiles: string;
  itemDetails: string;
  expand: string;
  collapse: string;
  item: string;
  items: string;
}

const STATUS_LABEL_ZH: Record<TaskStatus, string> = {
  pending: "待开始",
  running: "进行中",
  success: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_LABEL_EN: Record<TaskStatus, string> = {
  pending: "Pending",
  running: "Running",
  success: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ITEM_STATUS_LABEL_ZH: Record<TaskItemStatus, string> = {
  ...STATUS_LABEL_ZH,
  skipped: "已跳过",
  unchanged: "无变化",
};

const ITEM_STATUS_LABEL_EN: Record<TaskItemStatus, string> = {
  ...STATUS_LABEL_EN,
  skipped: "Skipped",
  unchanged: "Unchanged",
};

const TASK_KIND_ZH: Record<TaskRecordKind, { label: string; icon: string }> = {
  "pdf-translation": { label: "PDF 翻译", icon: "PDF" },
  "metadata-update": { label: "文献信息", icon: "元" },
  "title-translation": { label: "标题翻译", icon: "文" },
  "reading-note": { label: "AI 笔记", icon: "AI" },
  "literature-review": { label: "文献综述", icon: "综" },
};

const TASK_KIND_EN: Record<TaskRecordKind, { label: string; icon: string }> = {
  "pdf-translation": { label: "PDF translation", icon: "PDF" },
  "metadata-update": { label: "Metadata", icon: "MD" },
  "title-translation": { label: "Title translation", icon: "T" },
  "reading-note": { label: "AI note", icon: "AI" },
  "literature-review": { label: "Literature review", icon: "LR" },
};

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: "○",
  running: "◌",
  success: "✓",
  partial: "△",
  failed: "×",
  cancelled: "−",
};

/**
 * 在仪表盘窗口里挂载任务记录面板。返回卸载函数。
 */
export function mountQueuePanel(win: Window): () => void {
  const doc = win.document;
  const root = doc.getElementById("zotwanglele-queue-root");
  const listEl = doc.getElementById("zotwanglele-queue-list");
  const summaryEl = doc.getElementById("zotwanglele-queue-summary");
  const clearBtn = doc.getElementById("zotwanglele-queue-clear");
  if (!root || !listEl || !summaryEl) {
    ztoolkit.log("[TaskRecords] missing dom elements, abort mount");
    return () => undefined;
  }

  const expandedIds = new Set<string>();
  let latestTasks: TaskRecord[] = [];

  const onClear = () => clearFinishedTaskRecords();
  const onListClick = (event: Event) => {
    const target = event.target as Element | null;
    const toggle = target?.closest(
      ".zwl-task-card-toggle",
    ) as HTMLButtonElement | null;
    if (!toggle) return;

    const taskId = toggle.dataset.taskId;
    if (!taskId) return;
    const isExpanded = toggle.getAttribute("aria-expanded") === "true";
    const expanded = !isExpanded;
    if (expanded) {
      expandedIds.add(taskId);
    } else {
      expandedIds.delete(taskId);
    }
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? getCopy().collapse : getCopy().expand,
    );
    toggle.title = expanded ? getCopy().collapse : getCopy().expand;
    const card = toggle.closest(".zwl-task-card");
    const details = card?.querySelector(
      ".zwl-task-card-details",
    ) as HTMLElement | null;
    if (details) details.hidden = !expanded;
    const chevron = toggle.querySelector(".zwl-task-chevron");
    if (chevron) chevron.textContent = expanded ? "▾" : "▸";
  };

  clearBtn?.addEventListener("click", onClear);
  listEl.addEventListener("click", onListClick);
  const unsubscribe = subscribe((tasks) => {
    latestTasks = tasks;
    pruneTaskState(tasks, expandedIds);
    render(
      doc,
      listEl as HTMLElement,
      summaryEl as HTMLElement,
      tasks,
      expandedIds,
    );
  });

  return () => {
    unsubscribe();
    clearBtn?.removeEventListener("click", onClear);
    listEl.removeEventListener("click", onListClick);
  };
}

function render(
  doc: Document,
  listEl: HTMLElement,
  summaryEl: HTMLElement,
  tasks: TaskRecord[],
  expandedIds: Set<string>,
): void {
  const copy = getCopy();
  if (tasks.length === 0) {
    summaryEl.textContent = copy.emptySummary;
    const empty = createElement(doc, "div", "zwl-task-empty");
    const icon = createElement(doc, "span", "zwl-task-empty-icon");
    icon.setAttribute("aria-hidden", "true");
    appendChildren(
      empty,
      icon,
      createElement(doc, "strong", "", copy.emptySummary),
      createElement(doc, "p", "", copy.emptyDescription),
    );
    listEl.replaceChildren(empty);
    return;
  }

  const totals = countStatuses(tasks);
  summaryEl.textContent = formatSummary(totals, tasks.length);

  const sorted = [...tasks].reverse();
  listEl.replaceChildren(
    ...sorted.map((task) => {
      const expanded = getExpandedState(task, expandedIds);
      return renderTaskCard(doc, task, expanded);
    }),
  );
}

function renderTaskCard(
  doc: Document,
  task: TaskRecord,
  expanded: boolean,
): HTMLElement {
  const copy = getCopy();
  const isChinese = getIsChinese();
  const kind = (isChinese ? TASK_KIND_ZH : TASK_KIND_EN)[task.kind];
  const statusLabel = (isChinese ? STATUS_LABEL_ZH : STATUS_LABEL_EN)[
    task.status
  ];
  const card = createElement(doc, "article", "zwl-task-card");
  card.dataset.status = task.status;
  card.dataset.kind = task.kind;
  card.setAttribute("role", "listitem");

  const toggle = createElement(
    doc,
    "button",
    "zwl-task-card-toggle",
  ) as HTMLButtonElement;
  toggle.type = "button";
  toggle.dataset.taskId = task.id;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", expanded ? copy.collapse : copy.expand);
  toggle.title = expanded ? copy.collapse : copy.expand;

  const kindIcon = createElement(doc, "span", "zwl-task-kind-icon", kind.icon);
  kindIcon.setAttribute("aria-hidden", "true");

  const body = createElement(doc, "span", "zwl-task-card-body");
  const eyebrow = createElement(doc, "span", "zwl-task-card-eyebrow");
  appendChildren(
    eyebrow,
    createElement(doc, "span", "zwl-task-kind-label", kind.label),
    createElement(
      doc,
      "span",
      "zwl-task-target-count",
      formatTargetCount(task, copy),
    ),
  );
  const title = createElement(doc, "strong", "zwl-task-card-title", task.title);
  title.title = task.title;
  const summary = createElement(
    doc,
    "span",
    "zwl-task-card-summary",
    task.summary || task.step,
  );
  appendChildren(body, eyebrow, title, summary);

  const status = createElement(doc, "span", "zwl-task-status");
  status.dataset.status = task.status;
  const statusIcon = createElement(
    doc,
    "span",
    "zwl-task-status-icon",
    STATUS_ICON[task.status],
  );
  statusIcon.setAttribute("aria-hidden", "true");
  appendChildren(
    status,
    statusIcon,
    createElement(doc, "span", "zwl-task-status-label", statusLabel),
  );

  const progress = createElement(
    doc,
    "span",
    "zwl-task-progress-value",
    `${task.progress}%`,
  );
  const chevron = createElement(
    doc,
    "span",
    "zwl-task-chevron",
    expanded ? "▾" : "▸",
  );
  chevron.setAttribute("aria-hidden", "true");
  appendChildren(toggle, kindIcon, body, status, progress, chevron);

  const progressTrack = createElement(doc, "div", "zwl-task-progress-track");
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", "100");
  progressTrack.setAttribute("aria-valuenow", String(task.progress));
  const progressBar = createElement(doc, "div", "zwl-task-progress-bar");
  progressBar.dataset.status = task.status;
  progressBar.style.width = `${Math.max(0, Math.min(100, task.progress))}%`;
  progressTrack.appendChild(progressBar);

  const currentStep = createElement(
    doc,
    "p",
    "zwl-task-current-step",
    task.step,
  );
  const details = renderTaskDetails(doc, task, copy);
  details.id = `zwl-task-details-${task.id}`;
  details.setAttribute("role", "region");
  details.setAttribute("aria-label", task.title);
  toggle.setAttribute("aria-controls", details.id);
  details.hidden = !expanded;
  appendChildren(card, toggle, progressTrack, currentStep, details);
  return card;
}

function renderTaskDetails(
  doc: Document,
  task: TaskRecord,
  copy: TaskCopy,
): HTMLElement {
  const details = createElement(doc, "div", "zwl-task-card-details");
  const metadata = createElement(doc, "dl", "zwl-task-detail-grid");
  appendDetail(metadata, doc, copy.target, formatTargets(task, copy));
  if (task.startedAt) {
    appendDetail(metadata, doc, copy.started, formatDate(task.startedAt));
  }
  if (task.finishedAt) {
    appendDetail(metadata, doc, copy.finished, formatDate(task.finishedAt));
  }
  for (const detail of task.details ?? []) {
    appendDetail(metadata, doc, detail.label, detail.value);
  }
  appendPdfDetails(metadata, doc, task, copy);
  details.appendChild(metadata);

  if (task.itemResults && task.itemResults.length > 0) {
    details.appendChild(renderItemResults(doc, task.itemResults, copy));
  }
  const outputFiles =
    task.kind === "pdf-translation"
      ? (task as PdfTranslationTask).outputFiles
      : [];
  if (outputFiles.length > 0) {
    const section = createElement(doc, "section", "zwl-task-detail-section");
    section.appendChild(createElement(doc, "h4", "", copy.outputFiles));
    const files = createElement(doc, "ul", "zwl-task-file-list");
    for (const file of outputFiles) {
      files.appendChild(
        createElement(
          doc,
          "li",
          "",
          `${file.kind.toUpperCase()} · ${basename(file.path)}`,
        ),
      );
    }
    section.appendChild(files);
    details.appendChild(section);
  }
  if (task.lastLog) {
    details.appendChild(
      renderMessageSection(doc, copy.latestLog, task.lastLog, "log"),
    );
  }
  if (task.error) {
    details.appendChild(
      renderMessageSection(doc, copy.error, task.error, "error"),
    );
  }
  return details;
}

function appendPdfDetails(
  metadata: HTMLElement,
  doc: Document,
  task: TaskRecord,
  copy: TaskCopy,
): void {
  if (task.kind !== "pdf-translation") return;
  const translation = task as PdfTranslationTask;
  appendDetail(metadata, doc, "引擎", translation.engine);
  appendDetail(metadata, doc, "输出", translation.outputs.join(" + "));
  appendDetail(metadata, doc, "服务", translation.service);
  appendDetail(metadata, doc, "目标", translation.langOut);
  if (translation.pdfPath) {
    appendDetail(metadata, doc, "PDF", basename(translation.pdfPath));
  }
}

function renderItemResults(
  doc: Document,
  items: TaskItemResult[],
  copy: TaskCopy,
): HTMLElement {
  const isChinese = getIsChinese();
  const section = createElement(doc, "section", "zwl-task-detail-section");
  section.appendChild(createElement(doc, "h4", "", copy.itemDetails));
  const list = createElement(doc, "ul", "zwl-task-item-list");
  for (const item of items) {
    const row = createElement(doc, "li", "zwl-task-item-row");
    const title = createElement(
      doc,
      "strong",
      "zwl-task-item-title",
      item.title,
    );
    title.title = item.title;
    const label = (isChinese ? ITEM_STATUS_LABEL_ZH : ITEM_STATUS_LABEL_EN)[
      item.status
    ];
    const status = createElement(doc, "span", "zwl-task-item-status", label);
    status.dataset.status = item.status;
    const main = createElement(doc, "div", "zwl-task-item-main");
    appendChildren(main, title, status);
    row.appendChild(main);
    if (item.detail) {
      row.appendChild(
        createElement(doc, "p", "zwl-task-item-detail", item.detail),
      );
    }
    if (item.outputId) {
      row.appendChild(
        createElement(doc, "p", "zwl-task-item-output", `#${item.outputId}`),
      );
    }
    list.appendChild(row);
  }
  section.appendChild(list);
  return section;
}

function renderMessageSection(
  doc: Document,
  title: string,
  message: string,
  kind: "log" | "error",
): HTMLElement {
  const section = createElement(
    doc,
    "section",
    `zwl-task-detail-section is-${kind}`,
  );
  section.appendChild(createElement(doc, "h4", "", title));
  section.appendChild(createElement(doc, "pre", "zwl-task-message", message));
  return section;
}

function appendDetail(
  parent: HTMLElement,
  doc: Document,
  label: string,
  value: string,
): void {
  appendChildren(
    parent,
    createElement(doc, "dt", "", label),
    createElement(doc, "dd", "", value),
  );
}

function countStatuses(tasks: TaskRecord[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    running: 0,
    success: 0,
    partial: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const task of tasks) counts[task.status]++;
  return counts;
}

function formatSummary(
  counts: Record<TaskStatus, number>,
  total: number,
): string {
  if (getIsChinese()) {
    return `共 ${total} 条，进行 ${counts.pending + counts.running}，已完成 ${counts.success + counts.partial}，失败 ${counts.failed}`;
  }
  return `${total} total · ${counts.pending + counts.running} active · ${counts.success + counts.partial} completed · ${counts.failed} failed`;
}

function formatTargetCount(task: TaskRecord, copy: TaskCopy): string {
  const count = task.itemIds.length;
  return count === 1 ? `1 ${copy.item}` : `${count} ${copy.items}`;
}

function formatTargets(task: TaskRecord, copy: TaskCopy): string {
  if (task.itemTitles.length === 0) return formatTargetCount(task, copy);
  return task.itemTitles.join("\n");
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(getIsChinese() ? "zh-CN" : "en-US");
}

function getExpandedState(task: TaskRecord, expandedIds: Set<string>): boolean {
  return expandedIds.has(task.id);
}

function pruneTaskState(tasks: TaskRecord[], expandedIds: Set<string>): void {
  const ids = new Set(tasks.map((task) => task.id));
  for (const id of expandedIds) {
    if (!ids.has(id)) expandedIds.delete(id);
  }
}

function getCopy(): TaskCopy {
  if (getIsChinese()) {
    return {
      emptySummary: "暂无任务记录",
      emptyDescription:
        "从条目菜单发起翻译、信息更新或 AI 工作流后，处理记录会显示在这里。",
      target: "处理对象",
      started: "开始时间",
      finished: "结束时间",
      latestLog: "最新日志",
      error: "错误信息",
      outputFiles: "输出文件",
      itemDetails: "条目明细",
      expand: "查看详情",
      collapse: "收起详情",
      item: "篇文献",
      items: "篇文献",
    };
  }
  return {
    emptySummary: "No task records",
    emptyDescription:
      "Translation, metadata updates, and AI workflows started from item menus will appear here.",
    target: "Items",
    started: "Started",
    finished: "Finished",
    latestLog: "Latest log",
    error: "Error",
    outputFiles: "Output files",
    itemDetails: "Item details",
    expand: "Show details",
    collapse: "Hide details",
    item: "item",
    items: "items",
  };
}

function getIsChinese(): boolean {
  return Boolean(Zotero.locale?.startsWith("zh"));
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

function createElement(
  doc: Document,
  tag: string,
  className: string,
  text?: string,
): HTMLElement {
  const node = doc.createElementNS(HTML_NS, tag) as HTMLElement;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendChildren(parent: Node, ...children: Node[]): void {
  for (const child of children) parent.appendChild(child);
}

function basename(path: string): string {
  const match = path.match(/[\\/]([^\\/]+)$/);
  return match ? match[1] : path;
}
