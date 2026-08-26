/**
 * 兼容层：任务存储已提升为跨功能的统一任务记录。
 * 新代码请从 ../tasks/task-store 导入。
 */
export {
  addTask,
  clearFinishedTaskRecords,
  clearFinishedTasks,
  createTaskItems,
  getItemTitle,
  getTasks,
  subscribe,
  updateTask,
  type PdfTranslationTask as TranslateTask,
  type TaskDetail,
  type TaskItemResult,
  type TaskItemStatus,
  type TaskRecord,
  type TaskRecordKind,
  type TaskStatus,
} from "../tasks/task-store";
