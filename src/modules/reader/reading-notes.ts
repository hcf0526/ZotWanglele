import { getTemplate } from "../ai/prompts";
import { FULL_READ_TEMPLATE_ID, QUICK_SUMMARY_TEMPLATE_ID } from "./prompts";

export interface ReadingNoteDefinition {
  id: string;
  fallbackLabel: string;
  legacyLabels: string[];
}

export interface ReadingNoteRecord {
  note: Zotero.Item;
  html: string;
  previewHtml: string;
  modified: string;
}

export const READING_NOTE_DEFINITIONS: ReadingNoteDefinition[] = [
  {
    id: FULL_READ_TEMPLATE_ID,
    fallbackLabel: "论文精读",
    legacyLabels: ["AI 精读"],
  },
  {
    id: QUICK_SUMMARY_TEMPLATE_ID,
    fallbackLabel: "快速摘要",
    legacyLabels: [],
  },
];

export function getGeneratedNoteTag(templateId: string): string {
  return `ZotWanglele-AI:${templateId}`;
}

export async function resolveReadingParentItem(
  item: Zotero.Item | null | undefined,
): Promise<Zotero.Item | null> {
  if (!item) return null;
  const rawItem = item as any;
  if (rawItem.isAttachment?.() || rawItem.isNote?.()) {
    const parentId = rawItem.parentItemID || rawItem.parentID;
    if (!parentId) return null;
    return ((await Zotero.Items.getAsync(parentId)) as Zotero.Item) || null;
  }
  return rawItem.isRegularItem?.() ? item : null;
}

export async function findLatestReadingNote(
  item: Zotero.Item,
  templateId: string,
): Promise<ReadingNoteRecord | null> {
  const parent = await resolveReadingParentItem(item);
  if (!parent) return null;

  const definition = READING_NOTE_DEFINITIONS.find(
    (entry) => entry.id === templateId,
  );
  if (!definition) return null;

  const currentLabel =
    getTemplate(templateId)?.name ?? definition.fallbackLabel;
  const labels = [currentLabel, ...definition.legacyLabels];
  const noteIds = ((parent as any).getNotes?.() ?? []) as number[];
  const matches: ReadingNoteRecord[] = [];

  for (const noteId of noteIds) {
    const note = (await Zotero.Items.getAsync(noteId)) as Zotero.Item | null;
    if (!note || !(note as any).isNote?.()) continue;

    const html = String((note as any).getNote?.() ?? "");
    const tags = ((note as any).getTags?.() ?? []) as Array<{ tag?: string }>;
    const hasTag = tags.some(
      (entry) => entry.tag === getGeneratedNoteTag(templateId),
    );
    const hasHeading = labels.some((label) =>
      html.includes(`ZotWanglele · ${label}`),
    );
    if (!hasTag && !hasHeading) continue;

    matches.push({
      note,
      html,
      previewHtml: stripGeneratedHeading(html),
      modified: String((note as any).dateModified ?? ""),
    });
  }

  matches.sort(
    (left, right) =>
      right.modified.localeCompare(left.modified) ||
      right.note.id - left.note.id,
  );
  return matches[0] ?? null;
}

function stripGeneratedHeading(html: string): string {
  return html.replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, "");
}
