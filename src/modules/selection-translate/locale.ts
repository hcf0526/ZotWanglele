import { getString } from "../../utils/locale";

export function tr(key: string, args?: Record<string, unknown>): string {
  return getString(`selection-${key}` as any, { args });
}

export class TranslationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof TranslationError) return tr(`error-${error.code}`);
  if ((error as any)?.name === "TimeoutError") return tr("error-timeout");
  return tr("error-network");
}
