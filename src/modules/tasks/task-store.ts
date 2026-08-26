import { Engine, OutputKind } from "../translate/config";

export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "cancelled";

export type TaskRecordKind =
  | "pdf-translation"
  | "metadata-update"
  | "title-translation"
  | "reading-note"
  | "literature-review";

export type TaskItemStatus = TaskStatus | "skipped" | "unchanged";

export interface TaskDetail {
  label: string;
  value: string;
}

export interface TaskItemResult {
  itemId: number;
  title: string;
  status: TaskItemStatus;
  detail?: string;
  outputId?: number;
}

export interface TaskRecord {
  id: string;
  kind: TaskRecordKind;
  /** 显示用：任务名称或文献标题 */
  title: string;
  /** 任务涉及的 Zotero 主条目 */
  itemIds: number[];
  /** 任务涉及的文献标题快照 */
  itemTitles: string[];
  status: TaskStatus;
  /** 0-100 */
  progress: number;
  /** 当前步骤描述 */
  step: string;
  /** 卡片摘要中显示的任务结果 */
  summary?: string;
  /** 详情区域中显示的补充信息 */
  details?: TaskDetail[];
  /** 聚合任务的逐篇结果 */
  itemResults?: TaskItemResult[];
  /** 最后一条日志 */
  lastLog?: string;
  /** 错误消息 */
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface PdfTranslationTask extends TaskRecord {
  kind: "pdf-translation";
  /** Zotero 主条目 id */
  itemId: number;
  /** PDF 附件 id */
  attachmentId?: number;
  /** PDF 文件路径 */
  pdfPath?: string;
  engine: Engine;
  outputs: OutputKind[];
  langOut: string;
  service: string;
  /** 翻译输出文件路径（mono / dual） */
  outputFiles: { kind: OutputKind; path: string }[];
}

type TaskDefaults =
  | "id"
  | "status"
  | "progress"
  | "step"
  | "lastLog"
  | "outputFiles";

type Listener = (tasks: TaskRecord[]) => void;

const tasks: TaskRecord[] = [];
const listeners = new Set<Listener>();

export function getTasks(): TaskRecord[] {
  return tasks.slice();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener(getTasks());
  } catch {
    // ignore
  }
  return () => listeners.delete(listener);
}

export function addTask<T extends TaskRecord>(init: Omit<T, TaskDefaults>): T {
  const task: TaskRecord = {
    ...init,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    progress: 0,
    step: "等待开始",
    lastLog: "",
    ...(init.kind === "pdf-translation" ? { outputFiles: [] } : {}),
  };
  tasks.push(task);
  notify();
  return task as T;
}

export function updateTask(
  id: string,
  patch: Partial<TaskRecord> & Partial<PdfTranslationTask>,
): TaskRecord | null {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  tasks[index] = { ...tasks[index], ...patch };
  notify();
  return tasks[index];
}

export function clearFinishedTaskRecords(): void {
  for (let index = tasks.length - 1; index >= 0; index--) {
    const status = tasks[index].status;
    if (
      status === "success" ||
      status === "partial" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      tasks.splice(index, 1);
    }
  }
  notify();
}

/** 保留旧名称，避免翻译模块之外的调用中断。 */
export const clearFinishedTasks = clearFinishedTaskRecords;

export function createTaskItems(items: Zotero.Item[]): TaskItemResult[] {
  return items.map((item) => ({
    itemId: item.id,
    title: getItemTitle(item),
    status: "pending",
  }));
}

export function getItemTitle(item: Zotero.Item): string {
  return (item.getField("title") as string) || `条目 ${item.id}`;
}

function notify(): void {
  const snapshot = getTasks();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      ztoolkit.log("[TaskStore] listener error:", error);
    }
  }
}
