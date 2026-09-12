import { newAbortController } from "../../utils/request";
import { getSettings, ProviderId, TranslationSettings } from "./config";
import { errorMessage, tr } from "./locale";
import { normalizeSelection } from "./text";
import {
  prepareTranslator,
  PreparedTranslator,
  TranslationResult,
} from "./services";

export interface TranslationState {
  sourceText: string;
  text: string;
  provider: ProviderId;
  targetLang: string;
  status: "idle" | "ready" | "running" | "success" | "cancelled" | "error";
  error: string;
  fromCache: boolean;
}

export class TranslationSession {
  private state: TranslationState;
  private listeners = new Set<(state: Readonly<TranslationState>) => void>();
  private cache = new Map<string, TranslationResult>();
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private disposed = false;

  constructor(
    private settings: () => TranslationSettings = getSettings,
    private prepare: (
      settings: TranslationSettings,
    ) => PreparedTranslator = prepareTranslator,
  ) {
    const initial = this.settings();
    this.state = {
      sourceText: "",
      text: "",
      provider: initial.provider,
      targetLang: initial.targetLang,
      status: "idle",
      error: "",
      fromCache: false,
    };
  }

  get snapshot(): Readonly<TranslationState> {
    return this.state;
  }

  subscribe(listener: (state: Readonly<TranslationState>) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  setSelection(text: string): void {
    if (this.disposed || this.state.sourceText === text) return;
    this.cancelCurrent();
    this.state = {
      ...this.state,
      sourceText: text,
      text: "",
      error: "",
      fromCache: false,
      status: text.trim() ? "ready" : "idle",
    };
    this.emit();
  }

  setOptions(provider: ProviderId, targetLang: string): void {
    this.cancelCurrent();
    this.state = {
      ...this.state,
      provider,
      targetLang,
      text: "",
      error: "",
      fromCache: false,
      status: this.state.sourceText.trim() ? "ready" : "idle",
    };
    this.emit();
  }

  resetSettings(): void {
    this.cache.clear();
    const settings = this.settings();
    this.setOptions(settings.provider, settings.targetLang);
  }

  scheduleAutomatic(isSelectionPresent: () => boolean): void {
    this.clearTimer();
    if (
      !this.settings().automatic ||
      ["running", "success"].includes(this.state.status)
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (
        !this.disposed &&
        this.settings().enabled &&
        this.settings().automatic &&
        isSelectionPresent()
      )
        void this.run();
    }, 600);
  }

  async run(bypassCache = false): Promise<void> {
    this.clearTimer();
    if (
      this.disposed ||
      !this.settings().enabled ||
      this.state.status === "running"
    )
      return;
    const revision = ++this.revision;
    const current = () => !this.disposed && revision === this.revision;
    try {
      const text = normalizeSelection(this.state.sourceText);
      const settings = {
        ...this.settings(),
        provider: this.state.provider,
        targetLang: this.state.targetLang,
      };
      const translator = this.prepare(settings);
      const cacheKey = JSON.stringify([
        text,
        settings.sourceLang,
        settings.targetLang,
        translator.fingerprint,
      ]);
      const cached = this.cache.get(cacheKey);
      if (cached && !bypassCache) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        this.state = {
          ...this.state,
          text: cached.text,
          status: "success",
          error: "",
          fromCache: true,
        };
        this.emit();
        return;
      }
      this.controller = newAbortController();
      this.state = {
        ...this.state,
        text: "",
        error: "",
        fromCache: false,
        status: "running",
      };
      this.emit();
      const result = await translator.translate({
        text,
        sourceLang: settings.sourceLang,
        targetLang: settings.targetLang,
        signal: this.controller.signal,
        onChunk: (chunk) => {
          if (!current()) return;
          this.state = { ...this.state, text: this.state.text + chunk };
          this.emit();
        },
      });
      if (!current()) return;
      if (!result.text.trim()) throw new Error("Empty result");
      this.cache.set(cacheKey, result);
      while (this.cache.size > 50)
        this.cache.delete(this.cache.keys().next().value!);
      this.state = { ...this.state, text: result.text, status: "success" };
    } catch (error) {
      if (!current()) return;
      this.state = {
        ...this.state,
        status: (error as any)?.name === "AbortError" ? "cancelled" : "error",
        error: errorMessage(error),
      };
    } finally {
      if (current()) {
        this.controller = undefined;
        this.emit();
      }
    }
  }

  stop(): void {
    this.cancelCurrent();
    this.state = { ...this.state, status: "cancelled", error: "" };
    this.emit();
  }

  copyText(bilingual = false): string {
    return bilingual
      ? `${tr("original")}\n${this.state.sourceText}\n\n${tr("translation")}\n${this.state.text}`
      : this.state.text;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private cancelCurrent(): void {
    this.clearTimer();
    ++this.revision;
    this.controller?.abort();
    this.controller = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelCurrent();
    this.cache.clear();
    this.listeners.clear();
    this.state = { ...this.state, sourceText: "", text: "", status: "idle" };
  }
}
