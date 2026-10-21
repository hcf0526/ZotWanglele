import { assert } from "chai";
import { config } from "../package.json";
import {
  applySettingsSnapshot,
  buildFileUrl,
  createSettingsSnapshot,
  downloadSettings,
  loadWebDavConfig,
  uploadSettings,
  type WebDavConfig,
} from "../src/modules/sync/webdav";

const pref = (key: string) => `${config.prefsPrefix}.${key}`;

describe("WebDAV settings sync", function () {
  let original: Record<string, unknown>;
  let originalRequest: typeof Zotero.HTTP.request;

  beforeEach(function () {
    original = {};
    for (const key of [
      "ai.profiles",
      "ai.activeProfileId",
      "translate.engine",
      "selectionTranslate.deeplKey",
    ]) {
      original[key] = Zotero.Prefs.get(pref(key), true);
    }
    originalRequest = Zotero.HTTP.request;
  });

  afterEach(function () {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) Zotero.Prefs.clear(pref(key), true);
      else Zotero.Prefs.set(pref(key), value, true);
    }
    Zotero.HTTP.request = originalRequest;
  });

  it("exports plugin preferences and can omit secret values", function () {
    Zotero.Prefs.set(
      pref("ai.profiles"),
      JSON.stringify([
        {
          id: "sync-profile",
          supplier: "测试供应商",
          baseUrl: "https://example.com/v1",
          apiKey: "profile-secret",
          model: "test-model",
        },
      ]),
      true,
    );
    Zotero.Prefs.set(pref("ai.activeProfileId"), "sync-profile", true);
    Zotero.Prefs.set(pref("selectionTranslate.deeplKey"), "deepl-secret", true);
    Zotero.Prefs.set(pref("unrelated.preference"), "local-only", true);

    const full = createSettingsSnapshot(true);
    assert.equal(full.addonRef, config.addonRef);
    assert.equal(
      (full.settings["ai.profiles"] as string).includes("profile-secret"),
      true,
    );
    assert.equal(full.settings["selectionTranslate.deeplKey"], "deepl-secret");
    assert.notProperty(full.settings, "sync.webdav.password");
    assert.notProperty(full.settings, "unrelated.preference");

    const safe = createSettingsSnapshot(false);
    assert.equal(
      (safe.settings["ai.profiles"] as string).includes("profile-secret"),
      false,
    );
    assert.notProperty(safe.settings, "selectionTranslate.deeplKey");
  });

  it("uploads and downloads a WebDAV JSON settings file", async function () {
    const value: WebDavConfig = {
      url: "https://dav.example.test/root/",
      username: "user",
      password: "password",
      remotePath: "zotwanglele/settings.json",
      includeSecrets: true,
    };
    assert.equal(
      buildFileUrl(value),
      "https://dav.example.test/root/zotwanglele/settings.json",
    );
    Zotero.Prefs.set(pref("translate.engine"), "pdf2zh_next", true);
    const calls: Array<{
      method: string;
      url: string;
      body?: string;
      headers: Record<string, string>;
    }> = [];
    let remote = "";
    Zotero.HTTP.request = (async (
      method: string,
      url: string,
      options: { body?: string; headers: Record<string, string> },
    ) => {
      calls.push({ method, url, body: options.body, headers: options.headers });
      if (method === "PUT") remote = options.body ?? "";
      return { status: method === "GET" ? 200 : 201, responseText: remote };
    }) as any;

    const uploaded = await uploadSettings(value);
    assert.isAbove(uploaded.settingCount, 0);
    assert.include(calls[0].body ?? "", '"schemaVersion": 1');
    assert.match(calls[0].headers.Authorization, /^Basic /);

    const snapshot = JSON.parse(remote);
    snapshot.settings["translate.engine"] = "pdf2zh";
    remote = JSON.stringify(snapshot);
    const downloaded = await downloadSettings(value);
    assert.equal(downloaded.exportedAt, snapshot.exportedAt);
    assert.equal(Zotero.Prefs.get(pref("translate.engine"), true), "pdf2zh");
  });

  it("rejects settings from another plugin", function () {
    assert.throws(
      () =>
        applySettingsSnapshot({
          schemaVersion: 1,
          addonRef: "other-addon",
          exportedAt: new Date().toISOString(),
          includeSecrets: true,
          settings: {},
        }),
      /不兼容/,
    );
  });

  it("uses defaults for an unconfigured WebDAV profile", function () {
    assert.equal(loadWebDavConfig().remotePath, "zotwanglele-settings.json");
    assert.isTrue(loadWebDavConfig().includeSecrets);
  });
});
