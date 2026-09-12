import { AiClient } from "../ai/ai-client";
import { getActiveProfile, getProfile } from "../ai/profiles";
import { getActiveTemplate, renderPrompt } from "../ai/prompts";
import {
  cancellableDelay,
  requestText,
  throwIfAborted,
} from "../../utils/request";
import { TranslationSettings } from "./config";
import { TranslationError, tr } from "./locale";
import { splitText } from "./text";

export interface TranslationResult {
  text: string;
  detectedLang?: string;
}
export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
}
export interface PreparedTranslator {
  fingerprint: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

export function baiduSignature(
  appId: string,
  text: string,
  salt: string,
  key: string,
): string {
  return Zotero.Utilities.Internal.md5(appId + text + salt + key);
}

export function providerLanguage(
  provider: string,
  language: string,
): string | undefined {
  if (provider === "deepl") {
    if (language === "auto") return undefined;
    return (
      ({ "zh-CN": "ZH-HANS", "zh-TW": "ZH-HANT" } as Record<string, string>)[
        language
      ] || language.toUpperCase()
    );
  }
  if (provider === "baidu") {
    return (
      (
        {
          "zh-CN": "zh",
          "zh-TW": "cht",
          ja: "jp",
          ko: "kor",
          fr: "fra",
          es: "spa",
        } as Record<string, string>
      )[language] || language
    );
  }
  return language;
}

function checkStatus(status: number): void {
  if (status >= 200 && status < 300) return;
  if ([401, 403].includes(status)) throw new TranslationError("auth");
  if (status === 429) throw new TranslationError("rate-limit");
  if ([402, 456].includes(status)) throw new TranslationError("quota");
  throw new TranslationError("network");
}

async function jsonRequest(
  method: string,
  url: string,
  body: string | undefined,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<any> {
  const xhr = await requestText(
    method,
    url,
    { body, headers },
    { signal, timeoutMs: 30000 },
  );
  checkStatus(xhr.status);
  try {
    return JSON.parse(xhr.responseText || "");
  } catch {
    throw new TranslationError("response");
  }
}

function resultText(text: unknown): string {
  if (typeof text !== "string" || !text.trim())
    throw new TranslationError("empty-result");
  return text.trim();
}

let nextBaiduRequest = 0;

export function prepareTranslator(
  settings: TranslationSettings,
): PreparedTranslator {
  const saved = { ...settings };
  const profile = saved.aiProfileId
    ? getProfile(saved.aiProfileId)
    : getActiveProfile();
  const template = getActiveTemplate("selection-translate");
  if (
    saved.provider === "ai" &&
    (!profile?.baseUrl || !profile.model || !template)
  ) {
    throw new TranslationError("ai-config");
  }
  if (saved.provider === "deepl" && !saved.deeplKey.trim())
    throw new TranslationError("deepl-config");
  if (
    saved.provider === "baidu" &&
    (!saved.baiduAppId.trim() || !saved.baiduKey.trim())
  )
    throw new TranslationError("baidu-config");
  // Credentials influence cache validity, but only a digest is kept in the cache key.
  const fingerprint = Zotero.Utilities.Internal.md5(
    JSON.stringify([
      saved,
      saved.provider === "ai" ? [profile, template] : null,
    ]),
  );
  return {
    fingerprint,
    async translate(request) {
      throwIfAborted(request.signal);
      if (saved.provider === "ai") {
        const vars = {
          text: request.text,
          sourceLang: tr(`lang-${request.sourceLang}`),
          targetLang: tr(`lang-${request.targetLang}`),
        };
        const client = new AiClient({
          ...profile!,
          temperature: profile!.temperature / 100,
          maxRetries: 1,
        });
        try {
          const result = await client.chat(
            [
              {
                role: "system",
                content: renderPrompt(template!.systemPrompt, vars),
              },
              {
                role: "user",
                content: renderPrompt(template!.userPrompt, vars),
              },
            ],
            request.onChunk,
            { signal: request.signal, timeoutMs: 60000 },
          );
          return { text: resultText(result.content) };
        } catch (error) {
          if ((error as any)?.status) checkStatus((error as any).status);
          const message = String((error as any)?.message);
          if (error instanceof SyntaxError)
            throw new TranslationError("response");
          if (message.startsWith("AI "))
            throw new TranslationError(
              message.includes("empty")
                ? "empty-result"
                : message.includes("invalid")
                  ? "response"
                  : "incomplete",
            );
          throw error;
        }
      }
      const source = providerLanguage(saved.provider, request.sourceLang);
      const target = providerLanguage(saved.provider, request.targetLang);
      if (saved.provider === "deepl") {
        // DeepL's source language uses ZH for both Chinese writing systems.
        const data = await jsonRequest(
          "POST",
          `https://${saved.deeplPlan === "pro" ? "api" : "api-free"}.deepl.com/v2/translate`,
          JSON.stringify({
            text: [request.text],
            source_lang: source?.startsWith("ZH-") ? "ZH" : source,
            target_lang: target,
          }),
          {
            "Content-Type": "application/json",
            Authorization: `DeepL-Auth-Key ${saved.deeplKey.trim()}`,
          },
          request.signal,
        );
        return {
          text: resultText(data?.translations?.[0]?.text),
          detectedLang: data?.translations?.[0]?.detected_source_language,
        };
      }
      const chunks = splitText(
        request.text,
        saved.provider === "google" ? 500 : 1500,
      );
      let text = "";
      let detectedLang: string | undefined;
      for (const chunk of chunks) {
        throwIfAborted(request.signal);
        if (saved.provider === "google") {
          const query = new URLSearchParams({
            client: "gtx",
            sl: source!,
            tl: target!,
            dt: "t",
            q: chunk.text,
          });
          const data = await jsonRequest(
            "GET",
            `https://translate.googleapis.com/translate_a/single?${query}`,
            undefined,
            {},
            request.signal,
          );
          const segments = data?.[0];
          if (!Array.isArray(segments)) throw new TranslationError("response");
          text +=
            resultText(
              segments
                .map((segment) =>
                  typeof segment?.[0] === "string" ? segment[0] : "",
                )
                .join(""),
            ) + chunk.suffix;
          if (typeof data[2] === "string") detectedLang = data[2];
        } else {
          const start = Math.max(Date.now(), nextBaiduRequest);
          nextBaiduRequest = start + 1100;
          await cancellableDelay(start - Date.now(), request.signal);
          const salt = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const body = new URLSearchParams({
            q: chunk.text,
            from: source!,
            to: target!,
            appid: saved.baiduAppId.trim(),
            salt,
            sign: baiduSignature(
              saved.baiduAppId.trim(),
              chunk.text,
              salt,
              saved.baiduKey.trim(),
            ),
          });
          const data = await jsonRequest(
            "POST",
            "https://fanyi-api.baidu.com/api/trans/vip/translate",
            body.toString(),
            { "Content-Type": "application/x-www-form-urlencoded" },
            request.signal,
          );
          if (data?.error_code && String(data.error_code) !== "52000") {
            const code = String(data.error_code);
            throw new TranslationError(
              ["52003", "54001", "58000", "58002", "90107"].includes(code)
                ? "auth"
                : code === "54003"
                  ? "rate-limit"
                  : ["54004", "54005"].includes(code)
                    ? "quota"
                    : "response",
            );
          }
          if (!Array.isArray(data?.trans_result))
            throw new TranslationError("response");
          text +=
            resultText(
              data.trans_result.map((part: any) => part.dst).join("\n"),
            ) + chunk.suffix;
          detectedLang = data.from;
        }
      }
      return { text: resultText(text), detectedLang };
    },
  };
}
