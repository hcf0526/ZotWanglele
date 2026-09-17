import { newAbortController } from "../../utils/request";
import {
  getSettings,
  ProviderId,
  targetId,
  TranslationSettings,
} from "./config";
import { errorMessage, tr, TranslationError } from "./locale";
import { normalizeSelection, resolveTargets } from "./text";
import { prepareTranslator, PreparedTranslator, targetLabel } from "./services";
import {
  HistoryEntry,
  TranslationHistory,
  translationHistory,
} from "./history";

export interface ComparisonResult {
  id: string;
  provider: ProviderId;
  label: string;
  text: string;
  status: "ready" | "running" | "success" | "cancelled" | "error";
  error: string;
  fromCache: boolean;
}

export interface TranslationState {
  sourceText: string;
  text: string;
  provider: ProviderId | "configured";
  targetLang: string;
  status:
    | "idle"
    | "ready"
    | "running"
    | "success"
    | "partial"
    | "cancelled"
    | "error";
  error: string;
  fromCache: boolean;
  results: ComparisonResult[];
  planLabel: string;
}

export class TranslationSession {
  private state: TranslationState;
  private listeners = new Set<(state: Readonly<TranslationState>) => void>();
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private disposed = false;

  constructor(
    private settings: () => TranslationSettings = getSettings,
    private prepare: (
      settings: TranslationSettings,
    ) => PreparedTranslator = prepareTranslator,
    readonly history: TranslationHistory = translationHistory,
  ) {
    this.state = {
      sourceText: "",
      text: "",
      provider: "configured",
      targetLang: this.settings().targetLang,
      status: "idle",
      error: "",
      fromCache: false,
      results: [],
      planLabel: "",
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
    const results = this.state.results;
    const text =
      results.length === 1
        ? results[0].text
        : results
            .filter((result) => result.text)
            .map((result) => result.label + "\n" + result.text)
            .join("\n\n");
    this.state = { ...this.state, text };
    for (const listener of this.listeners) listener(this.state);
  }

  setSelection(text: string): void {
    if (this.disposed || this.state.sourceText === text) return;
    this.cancelCurrent();
    this.state = {
      ...this.state,
      sourceText: text,
      text: "",
      results: [],
      planLabel: "",
      error: "",
      fromCache: false,
      status: text.trim() ? "ready" : "idle",
    };
    this.emit();
    if (text.trim()) void this.restoreSelectionHistory();
  }

  setOptions(provider: TranslationState["provider"], targetLang: string): void {
    this.cancelCurrent();
    this.state = {
      ...this.state,
      provider,
      targetLang,
      text: "",
      results: [],
      planLabel: "",
      error: "",
      fromCache: false,
      status: this.state.sourceText.trim() ? "ready" : "idle",
    };
    this.emit();
    if (this.state.sourceText.trim()) void this.restoreSelectionHistory();
  }

  resetSettings(): void {
    this.setOptions("configured", this.settings().targetLang);
  }

  private plan(text: string) {
    const settings = { ...this.settings(), targetLang: this.state.targetLang };
    const plan = resolveTargets(text, settings);
    if (!plan.targets.length) throw new TranslationError("no-rule");
    const seen = new Set<string>();
    const jobs = plan.targets
      .map((target) => {
        const result: ComparisonResult = {
          id: targetId(target),
          provider: target.provider,
          label: targetLabel(target),
          text: "",
          status: "ready",
          error: "",
          fromCache: false,
        };
        try {
          const translator = this.prepare({ ...settings, ...target });
          return { result, translator };
        } catch (error) {
          result.status = "error";
          result.error = errorMessage(error);
          return { result, translator: undefined };
        }
      })
      .filter((job) => {
        const id = job.translator?.fingerprint || job.result.id;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    return {
      settings,
      jobs,
      label: plan.rule
        ? tr("rule-applied", {
            count: plan.count,
            unit: tr("unit-" + plan.rule.unit),
            min: plan.rule.min,
            max: plan.rule.max ?? tr("unlimited"),
          })
        : tr("default-plan"),
    };
  }

  /** A repeated selection can display saved results even in manual translation mode. */
  private async restoreSelectionHistory(): Promise<void> {
    const revision = this.revision;
    try {
      if (!this.settings().enabled) return;
      const text = normalizeSelection(this.state.sourceText);
      const { settings, jobs, label } = this.plan(text);
      await this.history.ready();
      if (this.disposed || revision !== this.revision) return;
      for (const { result, translator } of jobs) {
        const cached =
          translator &&
          this.history.find(
            text,
            settings.sourceLang,
            settings.targetLang,
            translator.fingerprint,
          );
        if (cached)
          Object.assign(result, {
            text: cached.text,
            status: "success",
            fromCache: true,
          });
      }
      if (!jobs.some(({ result }) => result.fromCache)) return;
      const complete = jobs.every(({ result }) => result.fromCache);
      this.state = {
        ...this.state,
        results: jobs.map(({ result }) => result),
        planLabel: label,
        status: complete ? "success" : "ready",
        fromCache: complete,
      };
      this.emit();
    } catch {
      // Selecting text remains possible when a provider or history file is unavailable.
    }
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

  async run(): Promise<void> {
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
      const { settings, jobs, label } = this.plan(text);
      this.controller = newAbortController();
      const signal = this.controller.signal;
      this.state = {
        ...this.state,
        text: "",
        error: "",
        fromCache: false,
        results: jobs.map(({ result }) => result),
        planLabel: label,
        status: "running",
      };
      this.emit();
      try {
        await this.history.ready();
      } catch {
        /* The history view displays storage errors. */
      }
      if (!current()) return;
      await Promise.all(
        jobs.map(async ({ result, translator }) => {
          if (!translator) return;
          const cached = this.history.find(
            text,
            settings.sourceLang,
            settings.targetLang,
            translator.fingerprint,
          );
          if (cached) {
            Object.assign(result, {
              text: cached.text,
              status: "success",
              fromCache: true,
            });
            this.emit();
            return;
          }
          result.status = "running";
          this.emit();
          try {
            const output = await translator.translate({
              text,
              sourceLang: settings.sourceLang,
              targetLang: settings.targetLang,
              signal,
              onChunk: (chunk) => {
                if (!current()) return;
                result.text += chunk;
                this.emit();
              },
            });
            if (!current()) return;
            if (!output.text.trim()) throw new TranslationError("empty-result");
            Object.assign(result, { text: output.text, status: "success" });
            this.emit();
            try {
              await this.history.record(
                text,
                settings.sourceLang,
                settings.targetLang,
                {
                  routeId: result.id,
                  fingerprint: translator.fingerprint,
                  provider: result.provider,
                  label: result.label,
                  text: result.text,
                  createdAt: Date.now(),
                },
              );
            } catch {
              /* A completed translation remains available for copying. */
            }
          } catch (error) {
            if (!current()) return;
            result.status =
              (error as any)?.name === "AbortError" ? "cancelled" : "error";
            result.error = errorMessage(error);
          }
          if (current()) this.emit();
        }),
      );
      if (!current()) return;
      const successful = jobs.filter(
        ({ result }) => result.status === "success",
      );
      this.state = {
        ...this.state,
        status:
          successful.length === jobs.length && jobs.length
            ? "success"
            : successful.length
              ? "partial"
              : "error",
        fromCache:
          jobs.length > 0 && jobs.every(({ result }) => result.fromCache),
      };
    } catch (error) {
      if (!current()) return;
      this.state = {
        ...this.state,
        status: "error",
        error: errorMessage(error),
      };
    } finally {
      if (current()) {
        this.controller = undefined;
        this.emit();
      }
    }
  }

  showHistory(entry: HistoryEntry): void {
    this.cancelCurrent();
    this.state = {
      ...this.state,
      sourceText: entry.sourceText,
      targetLang: entry.targetLang,
      status: "success",
      error: "",
      fromCache: true,
      planLabel: tr("history-entry"),
      results: entry.results.map((result) => ({
        id: result.routeId,
        provider: result.provider,
        label: result.label,
        text: result.text,
        status: "success",
        error: "",
        fromCache: true,
      })),
    };
    this.emit();
  }

  stop(): void {
    this.cancelCurrent();
    for (const result of this.state.results)
      if (["running", "ready"].includes(result.status))
        result.status = "cancelled";
    this.state = { ...this.state, status: "cancelled", error: "" };
    this.emit();
  }

  copyText(bilingual = false): string {
    return bilingual
      ? tr("original") +
          "\n" +
          this.state.sourceText +
          "\n\n" +
          tr("translation") +
          "\n" +
          this.state.text
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
    this.listeners.clear();
    this.state = {
      ...this.state,
      sourceText: "",
      text: "",
      results: [],
      status: "idle",
    };
  }
}
