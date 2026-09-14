import {
  getSettings,
  normalizeHistoryLimit,
  normalizeHistoryMaxMB,
  ProviderId,
  PROVIDERS,
} from "./config";

export interface HistoryResult {
  routeId: string;
  fingerprint: string;
  provider: ProviderId;
  label: string;
  text: string;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  updatedAt: number;
  results: HistoryResult[];
}

export interface HistoryStorage {
  read(): Promise<unknown>;
  write(entries: readonly HistoryEntry[]): Promise<void>;
}

function historyPath(): string {
  return PathUtils.join(
    (PathUtils as any).profileDir,
    "zotwanglele-selection-history.json",
  );
}

const fileStorage: HistoryStorage = {
  async read() {
    const path = historyPath();
    if (!(await IOUtils.exists(path))) return [];
    const data = (await IOUtils.readJSON(path)) as any;
    if (data?.version !== 1 || !Array.isArray(data.entries))
      throw new Error("history-format");
    return data.entries;
  },
  async write(entries) {
    const path = historyPath();
    await IOUtils.writeJSON(
      path,
      { version: 1, entries },
      { tmpPath: `${path}.tmp` },
    );
  },
};

function validEntry(entry: any): entry is HistoryEntry {
  return (
    !!entry &&
    typeof entry.id === "string" &&
    typeof entry.sourceText === "string" &&
    entry.sourceText.length <= 10000 &&
    typeof entry.sourceLang === "string" &&
    typeof entry.targetLang === "string" &&
    Number.isFinite(entry.updatedAt) &&
    Array.isArray(entry.results) &&
    entry.results.length > 0 &&
    entry.results.every(
      (result: any) =>
        result &&
        typeof result.routeId === "string" &&
        typeof result.fingerprint === "string" &&
        PROVIDERS.includes(result.provider) &&
        typeof result.label === "string" &&
        typeof result.text === "string" &&
        !!result.text.trim() &&
        Number.isFinite(result.createdAt),
    )
  );
}

/** UTF-8 bytes of the exact JSON payload written to disk. */
export function historyBytes(entries: readonly HistoryEntry[]): number {
  return utf8Bytes(JSON.stringify({ version: 1, entries }));
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Persistent history shared by reader sessions, with atomic, ordered file writes. */
export class TranslationHistory {
  private entries: HistoryEntry[] = [];
  private loading?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  error = "";

  constructor(
    private storage: HistoryStorage = fileStorage,
    private limit: () => number = () => getSettings().historyLimit,
    private maxMB: () => number = () => getSettings().historyMaxMB,
  ) {}

  private bounded(entries: HistoryEntry[]): HistoryEntry[] {
    const count = normalizeHistoryLimit(this.limit());
    const budget = normalizeHistoryMaxMB(this.maxMB()) * 1024 * 1024;
    let bytes = historyBytes([]);
    const kept: HistoryEntry[] = [];
    for (const entry of entries) {
      if (kept.length >= count) break;
      const size = utf8Bytes(JSON.stringify(entry)) + (kept.length ? 1 : 0);
      if (bytes + size > budget) continue;
      kept.push(entry);
      bytes += size;
    }
    return kept;
  }

  get snapshot(): readonly HistoryEntry[] {
    return this.entries;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  ready(): Promise<void> {
    if (!this.loading) {
      this.loading = this.storage
        .read()
        .then(async (data) => {
          if (!Array.isArray(data) || !data.every(validEntry))
            throw new Error("history-format");
          this.entries = data.sort((a, b) => b.updatedAt - a.updatedAt);
          const bounded = this.bounded(this.entries);
          if (this.entries.length !== bounded.length) {
            this.entries = bounded;
            await this.persist();
          }
          this.error = "";
          this.emit();
        })
        .catch((error) => {
          this.error = "history-read";
          this.loading = undefined;
          this.emit();
          throw error;
        });
    }
    return this.loading;
  }

  find(
    sourceText: string,
    sourceLang: string,
    targetLang: string,
    fingerprint: string,
  ): HistoryResult | undefined {
    if (
      normalizeHistoryLimit(this.limit()) === 0 ||
      normalizeHistoryMaxMB(this.maxMB()) === 0
    )
      return undefined;
    return this.entries
      .find(
        (entry) =>
          entry.sourceText === sourceText &&
          entry.sourceLang === sourceLang &&
          entry.targetLang === targetLang,
      )
      ?.results.find((result) => result.fingerprint === fingerprint);
  }

  async record(
    sourceText: string,
    sourceLang: string,
    targetLang: string,
    result: HistoryResult,
  ): Promise<void> {
    await this.ready();
    const limit = normalizeHistoryLimit(this.limit());
    if (!limit || !result.text.trim()) return;
    const id = Zotero.Utilities.Internal.md5(
      JSON.stringify([sourceText, sourceLang, targetLang]),
    );
    const previous = this.entries.find((entry) => entry.id === id);
    const entry: HistoryEntry = {
      id,
      sourceText,
      sourceLang,
      targetLang,
      updatedAt: Date.now(),
      results: [
        ...(previous?.results || []).filter(
          (item) => item.routeId !== result.routeId,
        ),
        { ...result },
      ],
    };
    this.entries = this.bounded([
      entry,
      ...this.entries.filter((item) => item.id !== id),
    ]);
    this.emit();
    await this.persist();
  }

  async trim(): Promise<void> {
    await this.ready();
    const bounded = this.bounded(this.entries);
    if (this.entries.length === bounded.length) return;
    this.entries = bounded;
    this.emit();
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    await this.ready();
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.emit();
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.ready();
    this.entries = [];
    this.emit();
    await this.persist();
  }

  private persist(): Promise<void> {
    const snapshot = this.entries.map((entry) => ({
      ...entry,
      results: entry.results.map((result) => ({ ...result })),
    }));
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.storage.write(snapshot))
      .then(() => {
        this.error = "";
        this.emit();
      })
      .catch((error) => {
        this.error = "history-write";
        this.emit();
        throw error;
      });
    return this.writes;
  }
}

export const translationHistory = new TranslationHistory();
