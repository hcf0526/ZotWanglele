/**
 * 翻译任务存储 + 事件分发。
 *
 * 让仪表盘 "翻译任务" tab 能实时拿到任务列表与进度。
 * 任务只存在内存里，重启后清空（首版够用）。
 */

import { Engine, OutputKind } from "./config";

export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export interface TranslateTask {
  id: string;
  /** Zotero 主条目 id */
  itemId: number;
  /** 显示用：文献标题 */
  title: string;
  /** PDF 附件 id */
  attachmentId: number;
  /** PDF 文件路径 */
  pdfPath: string;
  engine: Engine;
  outputs: OutputKind[];
  langOut: string;
  service: string;
  status: TaskStatus;
  /** 0-100 */
  progress: number;
  /** 当前步骤描述 */
  step: string;
  /** 最后一行 stdout */
  lastLog: string;
  /** 错误消息 */
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  /** 翻译输出文件路径（mono / dual） */
  outputFiles: { kind: OutputKind; path: string }[];
}

type Listener = (tasks: TranslateTask[]) => void;

const tasks: TranslateTask[] = [];
const listeners = new Set<Listener>();

export function getTasks(): TranslateTask[] {
  return tasks.slice();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // 初始触发一次
  try {
    listener(getTasks());
  } catch {
    // ignore
  }
  return () => listeners.delete(listener);
}

export function addTask(
  init: Omit<
    TranslateTask,
    "id" | "status" | "progress" | "step" | "lastLog" | "outputFiles"
  >,
): TranslateTask {
  const task: TranslateTask = {
    ...init,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    progress: 0,
    step: "等待开始",
    lastLog: "",
    outputFiles: [],
  };
  tasks.push(task);
  notify();
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<TranslateTask>,
): TranslateTask | null {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  tasks[idx] = { ...tasks[idx], ...patch };
  notify();
  return tasks[idx];
}

export function clearFinishedTasks(): void {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const s = tasks[i].status;
    if (s === "success" || s === "failed" || s === "cancelled") {
      tasks.splice(i, 1);
    }
  }
  notify();
}

function notify(): void {
  const snapshot = getTasks();
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch (e) {
      ztoolkit.log("[TaskStore] listener error:", e);
    }
  }
}
