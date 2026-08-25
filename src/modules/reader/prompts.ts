/**
 * 阅读功能的模板 ID 兼容层。
 *
 * 模板正文统一由 ai/prompts.ts 管理，保留这里的导出以兼容阅读模块的旧引用。
 */
import {
  getTemplate as getPromptTemplate,
  PromptTemplate,
} from "../ai/prompts";

export type ReadingTemplate = PromptTemplate;

export const FULL_READ_TEMPLATE_ID = "paper-reading";
export const QUICK_SUMMARY_TEMPLATE_ID = "quick-summary";

export function getReadingTemplate(id: string): ReadingTemplate | undefined {
  return getPromptTemplate(id);
}
