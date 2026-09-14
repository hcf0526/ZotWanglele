import { TranslationError } from "./locale";
import {
  getLengthRules,
  TranslationSettings,
  TranslationTarget,
} from "./config";

export function countText(text: string, unit: "words" | "characters"): number {
  if (unit === "characters") return Array.from(text.replace(/\s/gu, "")).length;
  // Treat Han characters individually; keep contractions and hyphenated words together.
  return (
    text
      .replace(/\p{Script=Han}/gu, " $& ")
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []
  ).length;
}

export function resolveTargets(
  text: string,
  settings: TranslationSettings,
): {
  targets: TranslationTarget[];
  rule?: TranslationSettings["lengthRules"][number];
  count?: number;
} {
  for (const rule of getLengthRules(settings)) {
    const count = countText(text, rule.unit);
    if (count >= rule.min && (rule.max === null || count < rule.max))
      return { targets: rule.targets, rule, count };
  }
  return { targets: [] };
}

export function normalizeSelection(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00ad\n?/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) throw new TranslationError("empty-selection");
  if (Array.from(normalized).length > 5000)
    throw new TranslationError("too-long");
  return normalized;
}

export interface TextChunk {
  text: string;
  suffix: string;
}

/** Split at sentence/word boundaries, retaining separators and Unicode code points. */
export function splitText(text: string, limit: number): TextChunk[] {
  const chars = Array.from(text);
  const chunks: TextChunk[] = [];
  for (let offset = 0; offset < chars.length; ) {
    let end = Math.min(offset + limit, chars.length);
    if (end < chars.length) {
      for (const pattern of [/[.!?。！？\n]/, /\s/]) {
        let boundary = end;
        while (
          boundary > offset + limit / 2 &&
          !pattern.test(chars[boundary - 1])
        )
          boundary--;
        if (boundary > offset + limit / 2) {
          end = boundary;
          break;
        }
      }
    }
    const piece = chars.slice(offset, end).join("");
    const content = piece.trimEnd();
    const suffix = piece.slice(content.length);
    if (content) chunks.push({ text: content, suffix });
    else if (chunks.length) chunks[chunks.length - 1].suffix += suffix;
    offset = end;
  }
  return chunks;
}
