/** Transport controls shared by AI and selection translation. */
export interface RequestControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function abortError(): Error {
  return Object.assign(new Error("Request cancelled"), { name: "AbortError" });
}

export function timeoutError(): Error {
  return Object.assign(new Error("Request timed out"), {
    name: "TimeoutError",
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function newAbortController(): AbortController {
  const ctor = (Zotero.getMainWindow() as any).AbortController;
  return new ctor();
}

export async function requestText(
  method: string,
  url: string,
  init: { headers?: Record<string, string>; body?: string },
  controls: RequestControls = {},
): Promise<XMLHttpRequest> {
  throwIfAborted(controls.signal);
  let cancel: (() => void) | undefined;
  const onAbort = () => cancel?.();
  controls.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const requestOptions = {
      ...init,
      responseType: "text",
      successCodes: false as const,
      timeout: controls.timeoutMs ?? 60000,
      logBodyLength: 0,
      errorDelayMax: 0,
      noRetryOnThrottle: true,
      cancellerReceiver: (fn: () => void) => {
        cancel = fn;
        if (controls.signal?.aborted) fn();
      },
    };
    const xhr = await Zotero.HTTP.request(method, url, requestOptions);
    throwIfAborted(controls.signal);
    return xhr;
  } catch (error) {
    throwIfAborted(controls.signal);
    const TimeoutException = (Zotero.HTTP as any).TimeoutException;
    if (
      (typeof TimeoutException === "function" &&
        error instanceof TimeoutException) ||
      (error as any)?.name === "TimeoutException"
    )
      throw timeoutError();
    throw error;
  } finally {
    controls.signal?.removeEventListener("abort", onAbort);
  }
}

export function cancellableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
