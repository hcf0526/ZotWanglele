import { assert } from "chai";
import { config } from "../package.json";
import { openDashboard } from "../src/modules/dashboard/dashboard";
import {
  DEFAULT_SETTINGS,
  PREF_PREFIX,
  setSetting,
} from "../src/modules/selection-translate/config";
import {
  getActiveId,
  listProfiles,
  saveProfiles,
  setActiveId,
} from "../src/modules/ai/profiles";
import {
  element,
  mountTranslationView,
} from "../src/modules/selection-translate/view";
import { TranslationSession } from "../src/modules/selection-translate/session";
import { TranslationHistory } from "../src/modules/selection-translate/history";

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await pause(50);
  }
  assert.fail("Window did not finish loading");
}
async function capture(win: Window, name: string, target?: HTMLElement) {
  const rectangle =
    target?.getBoundingClientRect() ??
    new (win as any).DOMRect(0, 0, win.innerWidth, win.innerHeight);
  const snapshot = await (
    win as any
  ).browsingContext.currentWindowGlobal.drawSnapshot(
    rectangle,
    1,
    "rgb(255,255,255)",
  );
  const canvas = element(win.document, "canvas");
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  canvas.getContext("2d")!.drawImage(snapshot, 0, 0);
  snapshot.close();
  const data = win.atob(canvas.toDataURL("image/png").split(",")[1]);
  await IOUtils.write(
    PathUtils.join((PathUtils as any).profileDir, name),
    Uint8Array.from(data, (char) => char.charCodeAt(0)),
  );
}

describe("selection translation native layout", function () {
  this.timeout(20000);
  let previousAddon: unknown, previousToolkit: unknown;

  before(function () {
    previousAddon = (globalThis as any).addon;
    previousToolkit = (globalThis as any).ztoolkit;
    (globalThis as any).addon = (Zotero as any)[config.addonInstance];
    (globalThis as any).ztoolkit = (globalThis as any).addon.data.ztoolkit;
  });

  after(function () {
    (globalThis as any).addon = previousAddon;
    (globalThis as any).ztoolkit = previousToolkit;
  });

  it("fits comparison choices and editable ranges inside a narrow dashboard", async function () {
    const prefs = new Map(
      Object.keys(DEFAULT_SETTINGS).map((key) => [
        key,
        Zotero.Prefs.get(PREF_PREFIX + key, true),
      ]),
    );
    const originalProfiles = listProfiles();
    const active = getActiveId();
    let win: Window | null = null;
    try {
      saveProfiles([
        {
          id: "layout-a",
          name: "a",
          supplier: "研究服务甲",
          provider: "custom",
          model: "reading-model",
          baseUrl: "https://example.invalid",
          apiKey: "test-only",
          format: "chat-completions",
          temperature: 70,
          maxTokens: 4096,
        },
        {
          id: "layout-b",
          name: "b",
          supplier: "研究服务乙",
          provider: "custom",
          model: "research-translation-with-a-long-model-name-for-layout-check",
          baseUrl: "https://example.invalid",
          apiKey: "test-only",
          format: "responses",
          temperature: 70,
          maxTokens: 4096,
        },
      ]);
      setActiveId("layout-a");
      const google = { provider: "google" as const, aiProfileId: "" };
      const ai = { provider: "ai" as const, aiProfileId: "layout-a" };
      setSetting("comparisonTargets", [google, ai]);
      setSetting("comparisonEnabled", true);
      setSetting("lengthRules", [
        { id: "short", unit: "words", min: 0, max: 10, targets: [google] },
        {
          id: "long",
          unit: "words",
          min: 10,
          max: null,
          targets: [google, ai],
        },
      ]);
      setSetting("lengthRulesEnabled", true);
      win = openDashboard(Zotero.getMainWindow(), "selection")!;
      await waitFor(() => !!win?.document.querySelector(".zwl-selection-rule"));
      win.resizeTo(820, 780);
      await pause(650);
      const host = win.document.getElementById(
        "zotwanglele-dashboard-selection-root",
      )!;
      assert.isAtMost(host.scrollWidth, host.clientWidth + 2);
      assert.lengthOf(host.querySelectorAll(".zwl-selection-rule"), 2);
      for (const field of host.querySelectorAll("input[type=number], select")) {
        const rect = field.getBoundingClientRect();
        assert.isAtMost(rect.right, host.getBoundingClientRect().right + 2);
      }
      await capture(win, "selection-settings-v018.png");
      host
        .querySelectorAll(".zwl-selection-rule")[1]
        .scrollIntoView({ block: "start" });
      await pause(100);
      await capture(win, "selection-rules-v018.png");
    } finally {
      win?.close();
      saveProfiles(originalProfiles);
      setActiveId(active);
      for (const [key, value] of prefs) {
        if (value === undefined) Zotero.Prefs.clear(PREF_PREFIX + key, true);
        else Zotero.Prefs.set(PREF_PREFIX + key, value, true);
      }
    }
  });

  it("keeps history and long model labels within 320 and 240 pixel reader panels", async function () {
    const win = Zotero.getMainWindow();
    const host = element(win.document, "div");
    host.style.cssText =
      "position:fixed;left:20px;top:20px;width:320px;max-height:800px;overflow:auto;z-index:99999;background:#fbf8f0";
    win.document.documentElement!.appendChild(host);
    const entry = {
      id: "layout",
      sourceText:
        "Attention allows the model to focus on relevant information during translation.",
      sourceLang: "en",
      targetLang: "zh-CN",
      updatedAt: Date.now(),
      results: [
        {
          routeId: "google:",
          fingerprint: "google",
          provider: "google" as const,
          label: "Google（实验性）",
          text: "注意力使模型在翻译过程中专注于相关信息。",
          createdAt: Date.now(),
        },
        {
          routeId: "ai:a",
          fingerprint: "ai-a",
          provider: "ai" as const,
          label: "研究服务甲/research-translation-with-a-long-model-name",
          text: "注意力机制使模型能够在翻译过程中关注相关信息。",
          createdAt: Date.now(),
        },
      ],
    };
    const history = new TranslationHistory({
      read: async () => [entry],
      write: async () => {},
    });
    const session = new TranslationSession(
      () => ({ ...DEFAULT_SETTINGS }),
      undefined,
      history,
    );
    const cleanup = mountTranslationView(host, session, false);
    try {
      await history.ready();
      session.showHistory(entry);
      await pause(200);
      assert.isAtMost(host.scrollWidth, host.clientWidth + 2);
      assert.equal(
        host.querySelectorAll(".zwl-selection-comparison").length,
        2,
      );
      await capture(win, "selection-sidebar-v018.png", host);
      host.style.width = "240px";
      await pause(100);
      assert.isAtMost(host.scrollWidth, host.clientWidth + 2);
      host.scrollTop = host.scrollHeight;
      const limit = host.querySelector(
        '[data-pref="historyLimit"]',
      ) as HTMLInputElement;
      limit.focus();
      assert.equal(win.document.activeElement, limit);
      await capture(win, "selection-history-v018.png", host);
    } finally {
      cleanup();
      session.dispose();
      host.remove();
    }
  });
});
