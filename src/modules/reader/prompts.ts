/**
 * 内置提示词模板。
 *
 * 阶段 3 先硬编码，后续阶段 8 在仪表盘实现用户自定义模板管理时
 * 再迁移到 ai/prompts.ts 并支持持久化。
 */

export interface ReadingTemplate {
  id: string;
  label: string;
  /** 系统提示，定义 AI 角色与产出风格 */
  system: string;
  /** 用户消息正文（与 PDF 内容拼接前的指令部分） */
  user: string;
}

/** 详细精读 — 全方位结构化笔记 */
export const TEMPLATE_FULL_READ: ReadingTemplate = {
  id: "full-read",
  label: "AI 精读",
  system: `你是资深科研助手，擅长把学术论文转化为结构化、易回顾的中文笔记。
要求：
- 使用 Markdown，层级清晰；
- 关键术语保留英文原文；
- 数学公式使用 LaTeX；
- 不要凭空发挥，没找到的信息标注 "未提及"；
- 不要复述全文，要精炼、要解释。`,
  user: `请基于下面这篇论文，输出一份精读笔记，结构如下：

# {论文标题（中文+英文）}

## 1. 一句话总结
（1-2 句话概括最核心的贡献）

## 2. 研究背景与问题
- **背景**：
- **要解决的核心问题**：
- **已有方法的不足**：

## 3. 方法
（解释关键方法、模型架构、算法思路。需要的话画出 mermaid 流程图。）

## 4. 实验
- **数据集**：
- **指标**：
- **主要结果**：
- **消融**：

## 5. 结论与启示
- **结论**：
- **作者展望**：
- **对我的启示**：

## 6. 关键术语
（5-10 个术语，带一句话解释）`,
};

/** 快速摘要 — 一段话总结 */
export const TEMPLATE_QUICK_SUMMARY: ReadingTemplate = {
  id: "quick-summary",
  label: "快速摘要",
  system: `你是科研助手。请用中文写出论文的快速摘要，重点是让我 30 秒读完就知道要点。`,
  user: `请基于这篇论文输出快速摘要：

# {论文标题}

**一句话**：用一句话讲清楚论文做了什么。

**亮点**（3-5 个 bullet）：
- ...

**适合谁读**：什么背景的人值得读这篇。`,
};

export const ALL_TEMPLATES: ReadingTemplate[] = [
  TEMPLATE_FULL_READ,
  TEMPLATE_QUICK_SUMMARY,
];

export function getTemplate(id: string): ReadingTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}
