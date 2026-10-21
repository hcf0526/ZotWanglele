/**
 * PDF 提取器：从 Zotero 条目中拿到 PDF 内容。
 *
 * 精读、摘要与综述统一走文件上传：
 * - Base64：整个 PDF 文件 → Base64，按 API 格式作为文件块发送
 * - 文本：仅作兼容保留，不再作为 PDF 相关任务的主路径
 */

/** 单个 PDF 上传体积上限（字节），避免请求体或上下文被撑爆 */
export const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface PdfAttachmentRef {
  /** 附件 itemID */
  attachmentId: number;
  /** 文件路径（绝对） */
  filePath: string;
  /** 文件大小（字节） */
  size: number;
}

/**
 * 取条目下第一个 PDF 附件。多个时按 Zotero 默认顺序取首个。
 */
export async function getFirstPdfAttachment(
  item: Zotero.Item,
): Promise<PdfAttachmentRef | null> {
  const attachmentIds = item.getAttachments(false);
  for (const id of attachmentIds) {
    const att = Zotero.Items.get(id) as Zotero.Item;
    if ((att as any).attachmentContentType !== "application/pdf") continue;
    const filePath = await (att as any).getFilePathAsync();
    if (!filePath) continue;
    let size = 0;
    try {
      const info = await (IOUtils as any).stat(filePath);
      size = info?.size ?? 0;
    } catch {
      // ignore
    }
    return { attachmentId: id, filePath, size };
  }
  return null;
}

/**
 * 从 PDF 提取已索引的纯文本。
 *
 * 依赖 Zotero 内置全文索引（默认开启）。如果该 PDF 还没被索引，会返回空串。
 */
export async function getPdfText(
  item: Zotero.Item,
  maxChars = 60_000,
): Promise<string> {
  const ref = await getFirstPdfAttachment(item);
  if (!ref) return "";

  // attachmentText 是异步 getter，返回索引文本
  try {
    const att = Zotero.Items.get(ref.attachmentId) as any;
    const text: string = await att.attachmentText;
    if (typeof text !== "string") return "";
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch (e) {
    ztoolkit.log("[PdfExtractor] getPdfText error:", e);
    return "";
  }
}

/**
 * 把 PDF 整个读出来转成 Base64 字符串（不含 data: 前缀）。
 *
 * 用于 Chat Completions 的 file 块与 Responses 的 input_file。
 */
export async function getPdfBase64(item: Zotero.Item): Promise<string | null> {
  const ref = await getFirstPdfAttachment(item);
  if (!ref) return null;
  try {
    const bytes: Uint8Array = await (IOUtils as any).read(ref.filePath);
    return bytesToBase64(bytes);
  } catch (e) {
    ztoolkit.log("[PdfExtractor] getPdfBase64 error:", e);
    return null;
  }
}

/** 估算 Base64 字符串对应的原始字节数 */
export function estimateBase64Bytes(base64: string): number {
  const clean = base64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** 为附件生成可上传的文件名 */
export function buildPdfFileName(title: string, fallback = "paper"): string {
  const base = (title || fallback).trim().slice(0, 48).replace(/\s+/g, " ");
  const safe = base.replace(/[\\/:*?"<>|]/g, "_") || fallback;
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

/**
 * 取条目的元数据片段，作为提示词上下文。
 */
export function getItemMeta(item: Zotero.Item): {
  title: string;
  authors: string;
  year: string;
  abstract: string;
  doi: string;
} {
  const title = (item.getField("title") as string) || "";
  const year = ((item.getField("date") as string) || "").slice(0, 4);
  const abstract = (item.getField("abstractNote") as string) || "";
  const doi = (item.getField("DOI") as string) || "";
  const creators = item.getCreators?.() ?? [];
  const authors = creators
    .map(
      (c: any) =>
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        c.lastName ||
        c.name ||
        "",
    )
    .filter(Boolean)
    .join(", ");
  return { title, authors, year, abstract, doi };
}

// ============================================================
// helpers
// ============================================================

function bytesToBase64(bytes: Uint8Array): string {
  // 分块拼接，避免 String.fromCharCode 在大数组上爆栈
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
