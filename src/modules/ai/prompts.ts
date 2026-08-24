// ============================================================
// Types
// ============================================================

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  builtin: boolean;
}

export interface PromptVariables {
  title?: string;
  authors?: string;
  abstract?: string;
  year?: string;
  keywords?: string;
  [key: string]: string | undefined;
}

// ============================================================
// 内置模板
// ============================================================

const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: "paper-reading",
    name: "论文精读",
    description: "详细分析背景、方法、实验、结论",
    systemPrompt:
      "你是一位资深的学术论文分析专家。请对用户提供的论文进行全面深入的分析。使用中文回答。",
    userPrompt: `请对以下论文进行精读分析：

**标题**: {{title}}
**作者**: {{authors}}
**年份**: {{year}}
**摘要**: {{abstract}}

请从以下几个方面进行详细分析：
1. **研究背景与动机**：该研究解决什么问题？为什么重要？
2. **核心方法**：使用了什么方法/技术？创新点在哪里？
3. **实验设计与结果**：实验如何设计？关键结果是什么？
4. **结论与贡献**：主要贡献是什么？有什么局限性？
5. **个人评价**：论文的优缺点，对领域的影响。`,
    builtin: true,
  },
  {
    id: "quick-summary",
    name: "快速摘要",
    description: "一段话总结核心贡献",
    systemPrompt:
      "你是一位学术摘要专家。用简洁的语言总结论文核心内容。使用中文回答。",
    userPrompt: `请用一段话（150-200字）总结以下论文的核心贡献：

**标题**: {{title}}
**作者**: {{authors}}
**摘要**: {{abstract}}`,
    builtin: true,
  },
  {
    id: "method-analysis",
    name: "方法分析",
    description: "聚焦研究方法和技术细节",
    systemPrompt:
      "你是一位技术方法分析专家。请专注于分析论文的研究方法和技术实现。使用中文回答。",
    userPrompt: `请分析以下论文的研究方法：

**标题**: {{title}}
**作者**: {{authors}}
**摘要**: {{abstract}}

请重点分析：
1. 使用了什么核心方法/算法/框架？
2. 方法的技术细节和实现流程
3. 与已有方法相比的创新之处
4. 方法的适用范围和局限性`,
    builtin: true,
  },
  {
    id: "multi-round",
    name: "多轮对话",
    description: "分轮提问再汇总",
    systemPrompt:
      "你是一位学术论文分析助手。请逐步回答用户关于论文的问题，每次专注于一个方面。使用中文回答。",
    userPrompt: `我想了解这篇论文：

**标题**: {{title}}
**作者**: {{authors}}
**摘要**: {{abstract}}

请先简要介绍这篇论文的研究背景和动机。`,
    builtin: true,
  },
  {
    id: "literature-review",
    name: "文献综述",
    description: "多文献对比分析，生成综述段落",
    systemPrompt:
      "你是一位学术综述写作专家。请根据提供的多篇文献信息，生成结构化的文献综述。使用中文回答。",
    userPrompt: `请根据以下文献信息生成一段文献综述：

{{abstract}}

请包含：
1. 各文献的主要贡献
2. 方法之间的异同对比
3. 研究趋势总结
4. 现有研究的不足和未来方向`,
    builtin: true,
  },
  {
    id: "translate-title",
    name: "翻译标题",
    description: "将英文标题翻译为中文",
    systemPrompt:
      "你是一位学术翻译专家。请准确翻译学术论文标题，保持学术用语的准确性。",
    userPrompt: `请将以下英文论文标题翻译为中文，只输出翻译结果：

{{title}}`,
    builtin: true,
  },
  {
    id: "auto-tag",
    name: "自动标签",
    description: "根据摘要生成关键词标签",
    systemPrompt:
      "你是一位学术关键词提取专家。请根据论文信息提取合适的关键词标签。",
    userPrompt: `请根据以下论文信息生成 3-5 个关键词标签，用逗号分隔，只输出标签：

**标题**: {{title}}
**摘要**: {{abstract}}
**关键词**: {{keywords}}`,
    builtin: true,
  },
];

// ============================================================
// 模板管理
// ============================================================

const CUSTOM_PROMPTS_PREF = `extensions.zotero.${config.addonRef}.ai.customPrompts`;
const BUILTIN_OVERRIDES_PREF = `extensions.zotero.${config.addonRef}.ai.builtinPromptOverrides`;

let customTemplates: PromptTemplate[] | null = null;
let builtinOverrides: Record<
  string,
  Partial<Omit<PromptTemplate, "id" | "builtin">>
> | null = null;

function readBuiltinOverrides(): Record<
  string,
  Partial<Omit<PromptTemplate, "id" | "builtin">>
> {
  if (builtinOverrides) return builtinOverrides;
  try {
    const stored = (Zotero.Prefs as any).get(BUILTIN_OVERRIDES_PREF, true);
    const parsed = JSON.parse(typeof stored === "string" ? stored : "{}");
    builtinOverrides = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    builtinOverrides = {};
  }
  return builtinOverrides ?? {};
}

function persistBuiltinOverrides(): void {
  (Zotero.Prefs as any).set(
    BUILTIN_OVERRIDES_PREF,
    JSON.stringify(readBuiltinOverrides()),
    true,
  );
}

function readCustomTemplates(): PromptTemplate[] {
  if (customTemplates) return customTemplates;

  const stored = (Zotero.Prefs as any).get(CUSTOM_PROMPTS_PREF, true);
  try {
    const parsed = JSON.parse(typeof stored === "string" ? stored : "[]");
    customTemplates = Array.isArray(parsed)
      ? parsed.filter(isStoredCustomTemplate).map((template) => ({
          ...template,
          builtin: false,
        }))
      : [];
  } catch {
    customTemplates = [];
  }
  return customTemplates;
}

function isStoredCustomTemplate(value: any): value is PromptTemplate {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.systemPrompt === "string" &&
    typeof value.userPrompt === "string"
  );
}

function persistCustomTemplates(): void {
  (Zotero.Prefs as any).set(
    CUSTOM_PROMPTS_PREF,
    JSON.stringify(readCustomTemplates()),
    true,
  );
}

export function getAllTemplates(): PromptTemplate[] {
  const overrides = readBuiltinOverrides();
  return [
    ...BUILTIN_TEMPLATES.map((template) => ({
      ...template,
      ...(overrides[template.id] ?? {}),
      builtin: true,
    })),
    ...readCustomTemplates(),
  ];
}

export function getTemplate(id: string): PromptTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

export function getBuiltinTemplates(): PromptTemplate[] {
  return getAllTemplates().filter((template) => template.builtin);
}

export function getCustomTemplates(): PromptTemplate[] {
  return [...readCustomTemplates()];
}

export function updateBuiltinTemplate(
  id: string,
  updates: Partial<Omit<PromptTemplate, "id" | "builtin">>,
): boolean {
  if (!BUILTIN_TEMPLATES.some((template) => template.id === id)) return false;
  readBuiltinOverrides()[id] = { ...readBuiltinOverrides()[id], ...updates };
  persistBuiltinOverrides();
  return true;
}

export function resetBuiltinTemplate(id: string): boolean {
  if (!BUILTIN_TEMPLATES.some((template) => template.id === id)) return false;
  delete readBuiltinOverrides()[id];
  persistBuiltinOverrides();
  return true;
}

export function addCustomTemplate(
  template: Omit<PromptTemplate, "builtin">,
): void {
  readCustomTemplates().push({ ...template, builtin: false });
  persistCustomTemplates();
}

export function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<PromptTemplate, "id" | "builtin">>,
): boolean {
  const templates = readCustomTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  templates[idx] = { ...templates[idx], ...updates };
  persistCustomTemplates();
  return true;
}

export function deleteCustomTemplate(id: string): boolean {
  const templates = readCustomTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  templates.splice(idx, 1);
  persistCustomTemplates();
  return true;
}

export function loadCustomTemplates(templates: PromptTemplate[]): void {
  customTemplates = templates.filter((t) => !t.builtin);
  persistCustomTemplates();
}

// ============================================================
// 变量替换
// ============================================================

export function renderPrompt(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return vars[key] ?? match;
  });
}
import { config } from "../../../package.json";
