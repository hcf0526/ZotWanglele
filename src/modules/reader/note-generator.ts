/**
 * 笔记生成器：把 PDF 附件 + 模板 → AI → 保存为 Zotero 子笔记。
 *
 * PDF 相关任务统一以文件上传方式提交；Chat Completions 使用 file 块，
 * Responses 使用 input_file。同一 Key 同时支持两种格式时优先 Responses。
 */

import { AiClient, ChatMessage, fileUploadMessage } from "../ai/ai-client";
import { ApiFormat } from "../ai/presets";
import {
  getActiveProfile,
  getModelLabel,
  resolveFileUploadProfile,
} from "../ai/profiles";
import {
  MAX_PDF_UPLOAD_BYTES,
  buildPdfFileName,
  estimateBase64Bytes,
  getPdfBase64,
  getItemMeta,
} from "./pdf-extractor";
import { getActiveTemplate, renderPrompt } from "../ai/prompts";
import { getGeneratedNoteTag } from "./reading-notes";

export interface GenerateOptions {
  /** 提示词管理中的内置模板 ID */
  templateId: string;
  /** 进度回调（status 行文字） */
  onProgress?: (text: string) => void;
}

export interface GenerateResult {
  ok: boolean;
  message: string;
  noteId?: number;
}

/**
 * 给单篇文献生成笔记。
 *
 * 流程：
 * 1. 校验：必须是常规条目（非笔记/附件），且要有可用 AI Profile
 * 2. 拿元数据 + PDF 附件 Base64
 * 3. 构造文件上传消息 → 调 AI
 * 4. 把返回的 Markdown 存为子笔记
 */
export async function generateNoteForItem(
  item: Zotero.Item,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { templateId, onProgress } = options;
  const log = (s: string) => {
    onProgress?.(s);
    ztoolkit.log("[NoteGenerator]", s);
  };

  // 1. 校验
  if (!item || !item.isRegularItem?.()) {
    return { ok: false, message: "请选择一篇常规文献条目（不是笔记或附件）" };
  }
  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    return { ok: false, message: "请先在偏好设置里配置一个 AI 配置档" };
  }
  const profile = resolveFileUploadProfile(activeProfile);
  if (!profile.baseUrl || !profile.apiKey || !profile.model) {
    return {
      ok: false,
      message: `配置档「${getModelLabel(profile)}」缺少 Base URL / API Key / 模型`,
    };
  }

  const template = getActiveTemplate(templateId);
  if (!template) {
    return {
      ok: false,
      message: "提示词模板不存在，请在提示词管理中检查内置模板",
    };
  }

  log("正在读取 PDF 附件…");
  const meta = getItemMeta(item);
  const pdfBase64 = await getPdfBase64(item);
  if (!pdfBase64) {
    return {
      ok: false,
      message: "找不到可用的 PDF 附件。请确认条目下已挂载 PDF 文件。",
    };
  }
  const pdfBytes = estimateBase64Bytes(pdfBase64);
  if (pdfBytes > MAX_PDF_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `PDF 约 ${Math.round(pdfBytes / (1024 * 1024))} MB，超过上传上限 ${Math.round(
        MAX_PDF_UPLOAD_BYTES / (1024 * 1024),
      )} MB。请先压缩或拆分 PDF。`,
    };
  }

  const userText = [
    renderPrompt(template.userPrompt, {
      title: meta.title || "（未填）",
      authors: meta.authors || "（未填）",
      year: meta.year || "（未填）",
      abstract: meta.abstract || "（未提供）",
      keywords: "",
    }),
    "",
    "---",
    "请阅读随附的 PDF 文件原文后完成任务；正文内容以附件为准。",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: template.systemPrompt },
    fileUploadMessage("user", userText, {
      filename: buildPdfFileName(meta.title),
      base64: pdfBase64,
      mimeType: "application/pdf",
    }),
  ];

  log(`正在以文件上传方式调用 ${getModelLabel(profile)}…`);
  const client = new AiClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    format: profile.format as ApiFormat,
    temperature: profile.temperature / 100,
    maxTokens: profile.maxTokens,
  });

  let result;
  try {
    result = await client.chat(messages);
  } catch (e: any) {
    return { ok: false, message: `AI 调用失败：${e?.message ?? String(e)}` };
  }

  const content = (result.content ?? "").trim();
  if (!content) {
    return { ok: false, message: "AI 返回空内容" };
  }

  log("正在保存笔记…");
  const noteId = await saveAsChildNote(
    item,
    templateId,
    template.name,
    content,
  );
  return {
    ok: true,
    message: `已生成 ${template.name}（笔记 #${noteId}）`,
    noteId,
  };
}

// ============================================================
// helpers
// ============================================================

/**
 * 把 Markdown 内容存为目标条目的子笔记。
 *
 * Zotero 笔记字段实际上是 HTML，所以这里做最小转换：
 * - 标题前缀
 * - Markdown 原文用 <pre> 包起来保留格式
 *
 * （后续可接入 markdown→html 转换器，但目前先求功能跑通。）
 */
async function saveAsChildNote(
  parent: Zotero.Item,
  templateId: string,
  templateLabel: string,
  markdown: string,
): Promise<number> {
  const note = new Zotero.Item("note");
  note.parentID = parent.id;

  const headHtml = `<h1>ZotWanglele · ${escapeHtml(templateLabel)}</h1>`;
  const bodyHtml = markdownToHtmlMinimal(markdown);
  note.setNote(`${headHtml}\n${bodyHtml}`);
  note.addTag(getGeneratedNoteTag(templateId));

  const saved = await note.saveTx();
  return typeof saved === "number" ? saved : note.id;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 极简 Markdown → HTML：保留段落、标题、代码块、列表的基础形式。
 * 不追求完美渲染，先让笔记可读。
 */
export function markdownToHtmlMinimal(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw;

    if (line.startsWith("```")) {
      closeList();
      if (!inCode) {
        out.push("<pre><code>");
        inCode = true;
      } else {
        out.push("</code></pre>");
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[\s]*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineMd(bullet[1])}</li>`);
      continue;
    }

    if (line.trim() === "") {
      closeList();
      out.push("");
      continue;
    }

    closeList();
    out.push(`<p>${inlineMd(line)}</p>`);
  }

  if (inCode) out.push("</code></pre>");
  closeList();

  return out.join("\n");
}

function inlineMd(s: string): string {
  let r = escapeHtml(s);
  r = r.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*(.+?)\*/g, "<em>$1</em>");
  r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
  return r;
}
