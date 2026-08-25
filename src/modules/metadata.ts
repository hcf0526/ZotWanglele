/**
 * Crossref 元数据获取、比较与选择性更新。
 *
 * Crossref REST API 公开提供 DOI 查询。请求带上 mailto 和 User-Agent，
 * 方便 Crossref 识别插件并按礼貌访问策略处理请求。
 */
import { config } from "../../package.json";

export const CROSSREF_MAILTO = "2971130350@qq.com";
export const CROSSREF_BASE_URL = "https://api.crossref.org/v1/works";
export const CROSSREF_UPDATED_KEY = "ZotWanglele-Crossref-Updated";
export const CROSSREF_MAILTO_KEY = "ZotWanglele-Crossref-Mailto";

const CROSSREF_USER_AGENT = `${config.addonName} (mailto:${CROSSREF_MAILTO})`;
const MAX_RETRIES = 2;

export type MetadataFieldKey =
  | "title"
  | "authors"
  | "abstractNote"
  | "DOI"
  | "date";

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  sequence?: string;
  affiliation?: Array<{ name?: string }>;
}

export interface CrossrefMetadata {
  doi: string;
  title: string;
  authors: CrossrefAuthor[];
  abstract: string;
  date: string;
  publisher?: string;
  containerTitle?: string;
  url?: string;
}

export interface MetadataFieldDiff {
  field: MetadataFieldKey;
  label: string;
  localValue: string;
  incomingValue: string;
}

export interface MetadataFetchResult {
  ok: boolean;
  message: string;
  metadata?: CrossrefMetadata;
  diffs?: MetadataFieldDiff[];
  needsCandidateSelection?: boolean;
}

export interface CrossrefCandidate {
  metadata: CrossrefMetadata;
  score?: number;
  containerTitle?: string;
}

export interface MetadataCandidateDialogResult {
  selectedIndex: number;
}

export interface MetadataCandidateDialogInput {
  itemTitle: string;
  candidates: CrossrefCandidate[];
}

export interface MetadataApplyResult {
  applied: MetadataFieldKey[];
}

export interface MetadataDialogInput {
  itemTitle: string;
  diffs: MetadataFieldDiff[];
}

export interface MetadataDialogResult {
  applied: boolean;
  selectedFields: MetadataFieldKey[];
}

export type MetadataItemStatus =
  | "success"
  | "failed"
  | "skipped"
  | "unchanged"
  | "pending";

/** 单个条目的处理结果，用于结果汇总窗口展示。 */
export interface MetadataItemResult {
  title: string;
  status: MetadataItemStatus;
  detail: string;
  selectable?: boolean;
  targetIndex?: number;
}

export interface MetadataResultDialogResult {
  selectedIndex: number;
}

const FIELD_LABELS: Record<MetadataFieldKey, string> = {
  title: "标题",
  authors: "作者",
  abstractNote: "摘要",
  DOI: "DOI",
  date: "日期",
};

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** 将 DOI URL、doi: 前缀和常见引用标点整理为 DOI 本体。 */
export function normalizeDoi(value: string): string {
  let doi = String(value ?? "")
    .trim()
    .replace(/^<+|>+$/g, "")
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:\s*/i, "")
    .replace(/\s+/g, "");

  // DOI 出现在句末时，引用标点通常不属于 DOI。
  doi = doi.replace(/[.,;:!?]+$/g, "");
  return doi;
}

/**
 * 请求 Crossref DOI 元数据。
 * 429 和 5xx 会按递增间隔重试，其余状态直接抛出可读错误。
 */
export async function fetchCrossrefMetadata(
  doi: string,
): Promise<CrossrefMetadata> {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error("DOI 为空");

  const url = `${CROSSREF_BASE_URL}/${encodeURIComponent(normalized)}?mailto=${encodeURIComponent(CROSSREF_MAILTO)}`;
  const payload = await requestCrossrefPayload(url);
  const metadata = parseCrossrefMessage(payload.message);
  if (!metadata.doi || !metadata.title) {
    throw new Error("Crossref 返回的元数据缺少 DOI 或标题");
  }
  return metadata;
}

/** 无 DOI 时按条目的书目信息搜索 Crossref 候选。 */
export async function searchCrossrefMetadata(
  item: Zotero.Item,
): Promise<CrossrefCandidate[]> {
  const title = fieldValue(item, "title");
  if (!title) throw new Error("条目没有标题，无法进行书目搜索");

  const params = new URLSearchParams();
  params.set("query.bibliographic", title);
  const authors = getLocalAuthors(item);
  if (authors) params.set("query.author", authors);
  const date = fieldValue(item, "date").match(/\b\d{4}\b/)?.[0];
  if (date)
    params.set("filter", `from-pub-date:${date},until-pub-date:${date}`);
  params.set("rows", "8");
  params.set("mailto", CROSSREF_MAILTO);

  const payload = await requestCrossrefPayload(
    `${CROSSREF_BASE_URL}?${params.toString()}`,
  );
  const items = Array.isArray(payload.message?.items)
    ? payload.message.items
    : [];
  return items
    .map((entry: any) => {
      try {
        const metadata = parseCrossrefMessage(entry);
        if (!metadata.doi || !metadata.title) return null;
        return {
          metadata,
          score: Number.isFinite(Number(entry?.score))
            ? Number(entry.score)
            : undefined,
          containerTitle: metadata.containerTitle,
        } as CrossrefCandidate;
      } catch {
        return null;
      }
    })
    .filter(
      (candidate: CrossrefCandidate | null): candidate is CrossrefCandidate =>
        Boolean(candidate),
    );
}

async function requestCrossrefPayload(url: string): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let xhr: any;
    try {
      xhr = await (Zotero as any).HTTP.request("GET", url, {
        headers: {
          "User-Agent": CROSSREF_USER_AGENT,
          Accept: "application/json",
        },
        responseType: "text",
        successCodes: false,
      });
    } catch (error: any) {
      const status = getHttpStatus(error);
      const normalizedError = normalizeRequestError(error);
      if (
        attempt === MAX_RETRIES ||
        (!isRetryableStatus(status) && status !== 0)
      ) {
        throw normalizedError;
      }
      lastError = normalizedError;
      await delay(1000 * (attempt + 1));
      continue;
    }

    const status = getHttpStatus(xhr);
    if (status >= 200 && status < 300) {
      try {
        const payload = JSON.parse(xhr?.responseText ?? "");
        if (!payload?.message)
          throw new Error("Crossref 响应中缺少 message 字段");
        return payload;
      } catch (error: any) {
        if (error?.message?.includes("Crossref 响应")) throw error;
        throw new Error("Crossref 响应解析失败");
      }
    }

    const error = createHttpError(status, xhr?.responseText, xhr?.statusText);
    if (!isRetryableStatus(status) || attempt === MAX_RETRIES) throw error;
    lastError = error;
    await delay(1000 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Crossref 请求失败");
}

function getHttpStatus(value: any): number {
  const candidates = [
    value?.status,
    value?.statusCode,
    value?.response?.status,
    value?.xhr?.status,
  ];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isFinite(status) && status > 0) return status;
  }
  return 0;
}

function normalizeRequestError(error: any): Error {
  const normalized =
    error instanceof Error ? error : new Error(error?.message ?? String(error));
  const status = getHttpStatus(error);
  if (status && !(normalized as any).status) {
    (normalized as any).status = status;
  }
  return normalized;
}

function createHttpError(
  status: number,
  responseText?: string,
  statusText?: string,
) {
  let detail = "";
  if (responseText) {
    try {
      const payload = JSON.parse(responseText);
      detail = payload?.message || payload?.error?.message || "";
    } catch {
      detail = String(responseText).slice(0, 160);
    }
  }
  const message = [
    `Crossref API 返回状态 ${status || "未知"}`,
    detail || statusText || "",
  ]
    .filter(Boolean)
    .join("：");
  const error: any = new Error(message);
  error.status = status;
  return error;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 把 Crossref message 转换为插件内部使用的结构。 */
export function parseCrossrefMessage(message: any): CrossrefMetadata {
  const titleValue = Array.isArray(message?.title)
    ? message.title[0]
    : message?.title;
  const authors = Array.isArray(message?.author)
    ? message.author.map(normalizeCrossrefAuthor).filter(Boolean)
    : [];

  return {
    doi: normalizeDoi(String(message?.DOI ?? "")),
    title: stripXml(String(titleValue ?? "")),
    authors,
    abstract: message?.abstract ? stripXml(String(message.abstract)) : "",
    date: parseCrossrefDate(message) ?? "",
    publisher: stringOrUndefined(message?.publisher),
    containerTitle: stringOrUndefined(
      Array.isArray(message?.["container-title"])
        ? message["container-title"][0]
        : message?.["container-title"],
    ),
    url: stringOrUndefined(message?.URL),
  };
}

function normalizeCrossrefAuthor(author: any): CrossrefAuthor | null {
  if (!author || typeof author !== "object") return null;
  const normalized: CrossrefAuthor = {
    given: cleanText(author.given),
    family: cleanText(author.family),
    name: cleanText(author.name),
    sequence: cleanText(author.sequence),
    affiliation: Array.isArray(author.affiliation)
      ? author.affiliation
          .map((entry: any) => ({ name: cleanText(entry?.name) }))
          .filter((entry: { name?: string }) => Boolean(entry.name))
      : undefined,
  };
  return normalized.given || normalized.family || normalized.name
    ? normalized
    : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = cleanText(value);
  return text || undefined;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 读取 Crossref 的日期字段，返回 YYYY、YYYY-MM 或 YYYY-MM-DD。 */
export function parseCrossrefDate(message: any): string | undefined {
  const candidates = [
    message?.issued?.["date-parts"]?.[0],
    message?.published?.["date-parts"]?.[0],
    message?.["published-print"]?.["date-parts"]?.[0],
    message?.["published-online"]?.["date-parts"]?.[0],
    message?.created?.["date-parts"]?.[0],
  ];

  for (const parts of candidates) {
    if (Array.isArray(parts)) {
      const formatted = formatDateParts(parts);
      if (formatted) return formatted;
    }
  }
  return undefined;
}

export function formatDateParts(parts: Array<number | string>): string {
  const year = Number(parts[0]);
  if (!Number.isFinite(year) || year <= 0) return "";

  const result = String(Math.trunc(year));
  const month = Number(parts[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return result;

  const monthText = String(month).padStart(2, "0");
  const day = Number(parts[2]);
  if (!Number.isInteger(day) || day < 1) return `${result}-${monthText}`;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (day > daysInMonth) return `${result}-${monthText}`;
  return `${result}-${monthText}-${String(day).padStart(2, "0")}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** 去除 JATS/XML 标签并解码常见实体。 */
export function stripXml(value: string): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) =>
      decodeCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      decodeCodePoint(parseInt(decimal, 10)),
    )
    .replace(
      /&(?:amp|apos|gt|lt|quot|nbsp);/gi,
      (entity) =>
        ({
          "&amp;": "&",
          "&apos;": "'",
          "&gt;": ">",
          "&lt;": "<",
          "&quot;": '"',
          "&nbsp;": " ",
        })[entity.toLowerCase()] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/** 以与 Crossref 显示格式一致的方式输出本地作者。 */
export function getLocalAuthors(item: Zotero.Item): string {
  const itemAny = item as any;
  const creators =
    (typeof itemAny.getCreatorsJSON === "function"
      ? itemAny.getCreatorsJSON()
      : itemAny.getCreators?.()) ?? [];
  return creators
    .filter((creator: any) => isAuthorCreator(creator))
    .map((creator: any) => formatCreator(creator))
    .filter(Boolean)
    .join("; ");
}

export function getIncomingAuthors(metadata: CrossrefMetadata): string {
  return (metadata.authors ?? []).map(formatCreator).filter(Boolean).join("; ");
}

function formatCreator(creator: any): string {
  const given = cleanText(creator?.given ?? creator?.firstName);
  const family = cleanText(creator?.family ?? creator?.lastName);
  const name = cleanText(creator?.name);
  return [given, family].filter(Boolean).join(" ") || name;
}

function isAuthorCreator(creator: any): boolean {
  const creatorType =
    creator?.creatorType ?? getCreatorTypeName(creator?.creatorTypeID);
  return !creatorType || creatorType === "author";
}

function getCreatorTypeName(creatorTypeID: unknown): string {
  if (creatorTypeID === undefined || creatorTypeID === null) return "";
  try {
    return (
      (Zotero as any).CreatorTypes?.getName?.(creatorTypeID) ?? ""
    ).toString();
  } catch {
    return "";
  }
}

export function parseIncomingAuthors(authors: CrossrefAuthor[]): Array<{
  creatorType: "author";
  firstName?: string;
  lastName?: string;
  name?: string;
}> {
  return authors.map((author) => {
    const given = cleanText(author.given);
    const family = cleanText(author.family);
    if (given || family) {
      return {
        creatorType: "author" as const,
        firstName: given,
        lastName: family,
      };
    }
    return { creatorType: "author" as const, name: cleanText(author.name) };
  });
}

/** 计算本地条目与 Crossref 结果之间的字段差异。 */
export function buildMetadataDiffs(
  item: Zotero.Item,
  metadata: CrossrefMetadata,
): MetadataFieldDiff[] {
  const diffs: MetadataFieldDiff[] = [];
  const add = (
    field: MetadataFieldKey,
    localValue: string,
    incomingValue: string,
    comparableIncoming = incomingValue,
    comparableLocal = localValue,
  ) => {
    if (!incomingValue.trim()) return;
    if (
      normalizeComparable(comparableLocal) ===
      normalizeComparable(comparableIncoming)
    ) {
      return;
    }
    diffs.push({
      field,
      label: FIELD_LABELS[field],
      localValue,
      incomingValue,
    });
  };

  add("title", fieldValue(item, "title"), metadata.title);
  add("authors", getLocalAuthors(item), getIncomingAuthors(metadata));
  add("abstractNote", fieldValue(item, "abstractNote"), metadata.abstract);
  add(
    "DOI",
    fieldValue(item, "DOI"),
    metadata.doi,
    normalizeDoi(metadata.doi),
    normalizeDoi(fieldValue(item, "DOI")),
  );
  add("date", fieldValue(item, "date"), metadata.date);

  return diffs;
}

function fieldValue(item: Zotero.Item, field: string): string {
  return String(item.getField(field) ?? "").trim();
}

function normalizeComparable(value: string): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/** 应用用户选中的字段，并保留 Extra 中的既有内容。 */
export async function applyMetadataFields(
  item: Zotero.Item,
  metadata: CrossrefMetadata,
  selectedFields: MetadataFieldKey[],
): Promise<MetadataApplyResult> {
  const applied: MetadataFieldKey[] = [];
  const selected = new Set(selectedFields);

  if (selected.has("title") && metadata.title) {
    item.setField("title", metadata.title);
    applied.push("title");
  }

  if (selected.has("authors") && (metadata.authors ?? []).length > 0) {
    const incoming = parseIncomingAuthors(metadata.authors ?? []);
    const existing = getCreatorJson(item);
    item.setCreators(replaceAuthorCreators(existing, incoming));
    applied.push("authors");
  }

  if (selected.has("abstractNote") && metadata.abstract) {
    item.setField("abstractNote", metadata.abstract);
    applied.push("abstractNote");
  }

  if (selected.has("DOI") && metadata.doi) {
    item.setField("DOI", metadata.doi);
    applied.push("DOI");
  }

  if (selected.has("date") && metadata.date) {
    item.setField("date", metadata.date);
    applied.push("date");
  }

  if (applied.length === 0) return { applied };

  const extra = fieldValue(item, "extra");
  item.setField("extra", setCrossrefMetadataInExtra(extra));
  await item.saveTx();
  return { applied };
}

function replaceAuthorCreators(existing: any[], incoming: any[]): any[] {
  if (existing.length === 0) return incoming;

  const result: any[] = [];
  let inserted = false;
  for (const creator of existing) {
    if (isAuthorCreator(creator)) {
      if (!inserted) {
        result.push(...incoming);
        inserted = true;
      }
      continue;
    }
    result.push(creator);
  }
  if (!inserted) result.push(...incoming);
  return result;
}

function getCreatorJson(item: Zotero.Item): any[] {
  const itemAny = item as any;
  if (typeof itemAny.getCreatorsJSON === "function") {
    const creators = itemAny.getCreatorsJSON();
    return Array.isArray(creators) ? creators : [];
  }
  if (typeof itemAny.getCreators === "function") {
    const creators = itemAny.getCreators();
    if (!Array.isArray(creators)) return [];
    return creators.map((creator: any) => ({
      ...creator,
      creatorType:
        creator.creatorType ?? getCreatorTypeName(creator.creatorTypeID),
    }));
  }
  return [];
}

export function setCrossrefMetadataInExtra(
  extra: string,
  timestamp = new Date().toISOString(),
): string {
  const lines = String(extra ?? "").split(/\r?\n/);
  const replacements: Record<string, string> = {
    [CROSSREF_UPDATED_KEY]: `${CROSSREF_UPDATED_KEY}: ${timestamp}`,
    [CROSSREF_MAILTO_KEY]: `${CROSSREF_MAILTO_KEY}: ${CROSSREF_MAILTO}`,
  };
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
    const key = match?.[1]?.trim();
    if (key && replacements[key]) {
      if (!seen.has(key)) {
        output.push(replacements[key]);
        seen.add(key);
      }
      continue;
    }
    output.push(line);
  }

  for (const key of [CROSSREF_UPDATED_KEY, CROSSREF_MAILTO_KEY]) {
    if (!seen.has(key)) output.push(replacements[key]);
  }

  return output.join("\n").trim();
}

/** 查询并生成对比数据，调用方决定是否打开窗口及保存字段。 */
export async function fetchAndCompareMetadata(
  item: Zotero.Item,
  parentWin?: Window,
  allowBibliographicSearch = true,
): Promise<MetadataFetchResult> {
  if (!item?.isRegularItem?.()) {
    return { ok: false, message: "请选择常规文献条目" };
  }

  const doi = normalizeDoi(fieldValue(item, "DOI"));
  try {
    let metadata: CrossrefMetadata;
    if (doi) {
      metadata = await fetchCrossrefMetadata(doi);
    } else {
      if (!allowBibliographicSearch) {
        return {
          ok: false,
          needsCandidateSelection: true,
          message: "条目没有 DOI 字段，请点击“选择”查找 Crossref 记录",
        };
      }
      if (!parentWin) {
        return {
          ok: false,
          message: "条目没有 DOI 字段，无法打开候选选择窗口",
        };
      }
      const candidates = await searchCrossrefMetadata(item);
      if (candidates.length === 0) {
        return { ok: false, message: "未找到匹配的 Crossref 书目记录" };
      }
      const selected = openMetadataCandidateDialog(
        parentWin,
        fieldValue(item, "title"),
        candidates,
      );
      if (selected === null) {
        return { ok: false, message: "已取消候选记录选择" };
      }
      metadata = candidates[selected].metadata;
    }

    return {
      ok: true,
      message: "Crossref 元数据获取成功",
      metadata,
      diffs: buildMetadataDiffs(item, metadata),
    };
  } catch (error: any) {
    return {
      ok: false,
      message: `Crossref 查询失败：${error?.message ?? String(error)}`,
    };
  }
}

/** 打开 Crossref 候选记录选择窗口，返回候选下标；取消返回 null。 */
export function openMetadataCandidateDialog(
  parentWin: Window,
  itemTitle: string,
  candidates: CrossrefCandidate[],
): number | null {
  const input: MetadataCandidateDialogInput = { itemTitle, candidates };
  const result: MetadataCandidateDialogResult = { selectedIndex: -1 };
  const url = `chrome://${config.addonRef}/content/metadata-candidate-dialog.xhtml`;
  try {
    (parentWin as any).openDialog(
      url,
      "zotwanglele-metadata-candidate-dialog",
      "chrome,centerscreen,modal,resizable=yes",
      input,
      result,
    );
  } catch (error) {
    ztoolkit.log("[Metadata] open candidate dialog failed:", error);
    return null;
  }
  return result.selectedIndex >= 0 ? result.selectedIndex : null;
}

/** 由 metadata-candidate-dialog.xhtml 的 onload 调用。 */
export function onMetadataCandidateDialogLoad(win: Window): void {
  const doc = win.document;
  const args = (win as any).arguments;
  const input: MetadataCandidateDialogInput = args?.[0] ?? {
    itemTitle: "",
    candidates: [],
  };
  const result: MetadataCandidateDialogResult = args?.[1] ?? {
    selectedIndex: -1,
  };
  const list = doc.getElementById("zwl-metadata-candidate-list");
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);

  const title = doc.getElementById("zwl-metadata-candidate-title");
  if (title) title.textContent = `选择 Crossref 记录：${input.itemTitle}`;

  input.candidates.forEach((candidate, index) => {
    const metadata = candidate.metadata;
    const row = doc.createElementNS(HTML_NAMESPACE, "label");
    row.className = "zwl-metadata-candidate-row";
    const radio = doc.createElementNS(
      HTML_NAMESPACE,
      "input",
    ) as HTMLInputElement;
    radio.type = "radio";
    radio.name = "candidate";
    radio.value = String(index);
    radio.checked = index === 0;
    const body = doc.createElementNS(HTML_NAMESPACE, "div");
    body.className = "zwl-metadata-candidate-body";
    const heading = doc.createElementNS(HTML_NAMESPACE, "div");
    heading.className = "zwl-metadata-candidate-heading";
    heading.textContent = `${index + 1}. ${metadata.title}`;
    const authors = getIncomingAuthors(metadata) || "作者未知";
    const info = doc.createElementNS(HTML_NAMESPACE, "div");
    info.className = "zwl-metadata-candidate-info";
    info.textContent = [
      authors,
      metadata.date || "年份未知",
      candidate.containerTitle || "期刊未知",
      metadata.doi,
    ]
      .filter(Boolean)
      .join(" · ");
    body.append(heading, info);
    row.append(radio, body);
    list.appendChild(row);
  });

  (win as any).zwlMetadataCandidateApply = () => {
    const selected = doc.querySelector(
      'input[name="candidate"]:checked',
    ) as HTMLInputElement | null;
    result.selectedIndex = selected ? Number(selected.value) : -1;
    win.close();
  };
  (win as any).zwlMetadataCandidateCancel = () => {
    result.selectedIndex = -1;
    win.close();
  };
}

/**
 * 打开字段对比窗口。模态窗口关闭后，返回用户选择的字段；取消返回 null。
 */
export function openMetadataComparisonDialog(
  parentWin: Window,
  itemTitle: string,
  diffs: MetadataFieldDiff[],
): MetadataFieldKey[] | null {
  const input: MetadataDialogInput = { itemTitle, diffs };
  const result: MetadataDialogResult = { applied: false, selectedFields: [] };
  const url = `chrome://${config.addonRef}/content/metadata-dialog.xhtml`;

  try {
    (parentWin as any).openDialog(
      url,
      "zotwanglele-metadata-dialog",
      "chrome,centerscreen,modal,resizable=yes",
      input,
      result,
    );
  } catch (error) {
    ztoolkit.log("[Metadata] open comparison dialog failed:", error);
    return null;
  }

  return result.applied ? result.selectedFields : null;
}

/** 由 metadata-dialog.xhtml 的 onload 调用。 */
export function onMetadataDialogLoad(win: Window): void {
  const doc = win.document;
  const args = (win as any).arguments;
  const input: MetadataDialogInput = args?.[0] ?? { itemTitle: "", diffs: [] };
  const result: MetadataDialogResult = args?.[1] ?? {
    applied: false,
    selectedFields: [],
  };
  const checkboxes: HTMLInputElement[] = [];
  const title = doc.getElementById("zwl-metadata-title");
  if (title) {
    title.textContent = input.itemTitle
      ? `更新文献信息：${input.itemTitle}`
      : "更新文献信息";
  }

  const list = doc.getElementById("zwl-metadata-diffs");
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);

  for (const diff of input.diffs) {
    const row = doc.createElementNS(HTML_NAMESPACE, "div");
    row.className = "zwl-metadata-row";

    const field = doc.createElementNS(HTML_NAMESPACE, "div");
    field.className = "zwl-metadata-field";
    field.textContent = diff.label;

    const local = createValueBlock(doc, "当前值", diff.localValue);
    const incoming = createValueBlock(doc, "Crossref", diff.incomingValue);

    const choice = doc.createElementNS(HTML_NAMESPACE, "div");
    choice.className = "zwl-metadata-choice";
    const checkbox = doc.createElementNS(
      HTML_NAMESPACE,
      "input",
    ) as HTMLInputElement;
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.value = diff.field;
    checkbox.setAttribute("aria-label", `接受${diff.label}更改`);
    choice.appendChild(checkbox);
    checkboxes.push(checkbox);

    row.append(field, local, incoming, choice);
    list.appendChild(row);
  }

  const empty = doc.getElementById("zwl-metadata-empty") as HTMLElement | null;
  if (empty) empty.hidden = input.diffs.length > 0;

  const w = win as any;
  w.zwlMetadataSelectAll = (checked: boolean) => {
    for (const checkbox of checkboxes) checkbox.checked = checked;
  };
  w.zwlMetadataApply = () => {
    result.selectedFields = checkboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value as MetadataFieldKey);
    result.applied = true;
    win.close();
  };
  w.zwlMetadataCancel = () => {
    if (result.applied) return;
    result.applied = false;
    result.selectedFields = [];
    win.close();
  };
}

function createValueBlock(
  doc: Document,
  caption: string,
  value: string,
): HTMLElement {
  const block = doc.createElementNS(HTML_NAMESPACE, "div") as HTMLElement;
  block.className = "zwl-metadata-value-block";

  const label = doc.createElementNS(HTML_NAMESPACE, "div");
  label.className = "zwl-metadata-caption";
  label.textContent = caption;

  const content = doc.createElementNS(HTML_NAMESPACE, "pre");
  content.className = "zwl-metadata-value";
  content.textContent = value || "（空）";

  block.append(label, content);
  return block;
}

const RESULT_STATUS_TEXT: Record<MetadataItemStatus, string> = {
  success: "已更新",
  failed: "失败",
  skipped: "已跳过",
  unchanged: "无变化",
  pending: "待选择",
};

/** 打开处理结果汇总窗口，返回用户选择的无 DOI 条目下标。 */
export function openMetadataResultDialog(
  parentWin: Window,
  results: MetadataItemResult[],
): number | null {
  const result: MetadataResultDialogResult = { selectedIndex: -1 };
  const url = `chrome://${config.addonRef}/content/metadata-result-dialog.xhtml`;
  try {
    (parentWin as any).openDialog(
      url,
      "zotwanglele-metadata-result-dialog",
      "chrome,centerscreen,modal,resizable=yes",
      results,
      result,
    );
  } catch (error) {
    ztoolkit.log("[Metadata] open result dialog failed:", error);
    return null;
  }
  return result.selectedIndex >= 0 ? result.selectedIndex : null;
}

/** 由 metadata-result-dialog.xhtml 的 onload 调用。 */
export function onMetadataResultDialogLoad(win: Window): void {
  const doc = win.document;
  const args = (win as any).arguments;
  const results: MetadataItemResult[] = args?.[0] ?? [];
  const dialogResult: MetadataResultDialogResult = args?.[1] ?? {
    selectedIndex: -1,
  };

  const list = doc.getElementById("zwl-metadata-result-list");
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);

  for (const itemResult of results) {
    const row = doc.createElementNS(HTML_NAMESPACE, "div");
    row.className = "zwl-metadata-result-row";

    const badge = doc.createElementNS(HTML_NAMESPACE, "div");
    badge.className = `zwl-metadata-result-badge zwl-metadata-result-${itemResult.status}`;
    badge.textContent =
      RESULT_STATUS_TEXT[itemResult.status] ?? itemResult.status;

    const body = doc.createElementNS(HTML_NAMESPACE, "div");
    body.className = "zwl-metadata-result-body";

    const title = doc.createElementNS(HTML_NAMESPACE, "div");
    title.className = "zwl-metadata-result-title";
    title.textContent = itemResult.title || "未命名条目";

    const detail = doc.createElementNS(HTML_NAMESPACE, "div");
    detail.className = "zwl-metadata-result-detail";
    detail.textContent = itemResult.detail || "";

    body.append(title, detail);
    if (itemResult.selectable && itemResult.status === "pending") {
      const choose = doc.createElementNS(
        HTML_NAMESPACE,
        "button",
      ) as HTMLButtonElement;
      choose.className = "zwl-metadata-result-choose";
      choose.textContent = "选择";
      choose.addEventListener("click", () => {
        dialogResult.selectedIndex = results.indexOf(itemResult);
        win.close();
      });
      row.append(badge, body, choose);
    } else {
      row.append(badge, body);
    }
    list.appendChild(row);
  }

  const empty = doc.getElementById(
    "zwl-metadata-result-empty",
  ) as HTMLElement | null;
  if (empty) empty.hidden = results.length > 0;

  (win as any).zwlMetadataResultClose = () => win.close();
}
