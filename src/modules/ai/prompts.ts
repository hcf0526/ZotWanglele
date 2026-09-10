import { config } from "../../../package.json";

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
  /** 归属的内置功能 ID；内置模板的 featureId 等于自身 id。 */
  featureId: string;
}

export interface PromptFeature {
  id: string;
  name: string;
  description: string;
}

export const UNGROUPED_FEATURE_ID = "ungrouped";

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
    systemPrompt: `你是资深科研助手，擅长把学术论文转化为结构化、易回顾的中文笔记。
要求：
- 使用 Markdown，层级清晰；
- 关键术语保留英文原文；
- 数学公式使用 LaTeX；
- 不要凭空发挥，没找到的信息标注 "未提及"；
- 不要复述全文，要精炼、要解释。`,
    userPrompt: `请基于下面这篇论文，输出一份精读笔记，结构如下：

# {{title}}

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
（5-10 个术语，带一句话解释）

**作者**：{{authors}}
**年份**：{{year}}
**摘要**：{{abstract}}`,
    builtin: true,
    featureId: "paper-reading",
  },
  {
    id: "quick-summary",
    name: "快速摘要",
    description: "一段话总结核心贡献",
    systemPrompt: `你是科研助手。请用中文写出论文的快速摘要，重点是让我 30 秒读完就知道要点。`,
    userPrompt: `请基于这篇论文输出快速摘要：

# {{title}}

**作者**：{{authors}}
**年份**：{{year}}
**摘要**：{{abstract}}

**一句话**：用一句话讲清楚论文做了什么。

**亮点**（3-5 个 bullet）：
- ...

**适合谁读**：什么背景的人值得读这篇。`,
    builtin: true,
    featureId: "quick-summary",
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
    featureId: "method-analysis",
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
    featureId: "multi-round",
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
    featureId: "literature-review",
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
    featureId: "translate-title",
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
    featureId: "auto-tag",
  },
];

// ============================================================
// 模板管理
// ============================================================

const CUSTOM_PROMPTS_PREF = `extensions.zotero.${config.addonRef}.ai.customPrompts`;
const BUILTIN_OVERRIDES_PREF = `extensions.zotero.${config.addonRef}.ai.builtinPromptOverrides`;
const ACTIVE_PROMPTS_PREF = `extensions.zotero.${config.addonRef}.ai.activePrompts`;

type BuiltinPromptOverride = Partial<
  Pick<PromptTemplate, "systemPrompt" | "userPrompt">
>;

let customTemplates: PromptTemplate[] | null = null;
let builtinOverrides: Record<string, BuiltinPromptOverride> | null = null;
let activeTemplateIds: Record<string, string> | null = null;

const BUILTIN_FEATURE_IDS = new Set(
  BUILTIN_TEMPLATES.map((template) => template.id),
);

// Hide these features from prompt management while retaining saved templates.
const HIDDEN_FEATURE_IDS = new Set(["method-analysis", "multi-round"]);

function isKnownFeatureId(id: string): boolean {
  return BUILTIN_FEATURE_IDS.has(id);
}

function normalizeFeatureId(value: unknown): string {
  return typeof value === "string" && isKnownFeatureId(value) ? value : "";
}

function readBuiltinOverrides(): Record<string, BuiltinPromptOverride> {
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
          featureId: normalizeFeatureId(template.featureId),
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

function readActiveTemplateIds(): Record<string, string> {
  if (activeTemplateIds) return activeTemplateIds;
  try {
    const stored = (Zotero.Prefs as any).get(ACTIVE_PROMPTS_PREF, true);
    const parsed = JSON.parse(typeof stored === "string" ? stored : "{}");
    activeTemplateIds = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    activeTemplateIds = {};
  }
  return activeTemplateIds ?? {};
}

function persistActiveTemplateIds(): void {
  (Zotero.Prefs as any).set(
    ACTIVE_PROMPTS_PREF,
    JSON.stringify(readActiveTemplateIds()),
    true,
  );
}

export function getBuiltinTemplateName(id: string): string | undefined {
  return BUILTIN_TEMPLATES.find((template) => template.id === id)?.name;
}

export function getPromptFeatures(): PromptFeature[] {
  const features: PromptFeature[] = BUILTIN_TEMPLATES.filter(
    (template) => !HIDDEN_FEATURE_IDS.has(template.id),
  ).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
  }));
  if (
    readCustomTemplates().some(
      (template) => !isKnownFeatureId(template.featureId),
    )
  ) {
    features.push({
      id: UNGROUPED_FEATURE_ID,
      name: "未分组",
      description: "尚未归入具体功能的模板",
    });
  }
  return features;
}

export function getTemplatesForFeature(featureId: string): PromptTemplate[] {
  if (featureId === UNGROUPED_FEATURE_ID) {
    return getCustomTemplates().filter(
      (template) => !isKnownFeatureId(template.featureId),
    );
  }
  return getAllTemplates().filter(
    (template) => template.featureId === featureId,
  );
}

export function getActiveTemplateId(featureId: string): string {
  if (!isKnownFeatureId(featureId)) {
    return getTemplatesForFeature(featureId)[0]?.id ?? "";
  }
  const stored = readActiveTemplateIds()[featureId];
  const templates = getTemplatesForFeature(featureId);
  if (stored && templates.some((template) => template.id === stored)) {
    return stored;
  }
  return featureId;
}

export function getActiveTemplate(
  featureId: string,
): PromptTemplate | undefined {
  const activeId = getActiveTemplateId(featureId);
  return (
    getTemplatesForFeature(featureId).find(
      (template) => template.id === activeId,
    ) ?? getTemplate(featureId)
  );
}

export function setActiveTemplate(
  featureId: string,
  templateId: string,
): boolean {
  if (!isKnownFeatureId(featureId)) return false;
  const template = getTemplatesForFeature(featureId).find(
    (item) => item.id === templateId,
  );
  if (!template) return false;
  if (templateId === featureId) {
    delete readActiveTemplateIds()[featureId];
  } else {
    readActiveTemplateIds()[featureId] = templateId;
  }
  persistActiveTemplateIds();
  return true;
}

export function getAllTemplates(): PromptTemplate[] {
  const overrides = readBuiltinOverrides();
  return [
    ...BUILTIN_TEMPLATES.map((template) => {
      const override = overrides[template.id] ?? {};
      return {
        ...template,
        systemPrompt: override.systemPrompt ?? template.systemPrompt,
        userPrompt: override.userPrompt ?? template.userPrompt,
        // Built-in function names always come from the source definition.
        builtin: true,
      };
    }),
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
  updates: BuiltinPromptOverride,
): boolean {
  if (!BUILTIN_TEMPLATES.some((template) => template.id === id)) return false;
  const { systemPrompt, userPrompt } = updates;
  readBuiltinOverrides()[id] = {
    ...readBuiltinOverrides()[id],
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
    ...(userPrompt !== undefined ? { userPrompt } : {}),
  };
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
  template: Omit<PromptTemplate, "builtin" | "featureId"> & {
    featureId?: string;
  },
): void {
  readCustomTemplates().push({
    ...template,
    builtin: false,
    featureId: normalizeFeatureId(template.featureId),
  });
  persistCustomTemplates();
}

export function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<PromptTemplate, "id" | "builtin">>,
): boolean {
  const templates = readCustomTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  templates[idx] = {
    ...templates[idx],
    ...updates,
    featureId: normalizeFeatureId(
      updates.featureId ?? templates[idx].featureId,
    ),
  };
  persistCustomTemplates();
  return true;
}

export function deleteCustomTemplate(id: string): boolean {
  const templates = readCustomTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  const [removed] = templates.splice(idx, 1);
  persistCustomTemplates();
  if (removed?.featureId) {
    const active = readActiveTemplateIds();
    if (active[removed.featureId] === id) {
      delete active[removed.featureId];
      persistActiveTemplateIds();
    }
  }
  return true;
}

export function loadCustomTemplates(templates: PromptTemplate[]): void {
  customTemplates = templates
    .filter((t) => !t.builtin)
    .map((template) => ({
      ...template,
      builtin: false,
      featureId: normalizeFeatureId(template.featureId),
    }));
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
