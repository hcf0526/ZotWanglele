import { assert } from "chai";
import { AiClient } from "../src/modules/ai/ai-client";
import {
  getActiveId,
  getSupplierDraft,
  listProfiles,
  listModelProfiles,
  moveProfile,
  saveProfiles,
  saveSupplier,
  setActiveId,
  type SupplierDraft,
} from "../src/modules/ai/profiles";
import {
  getChatProfilesForTranslation,
  loadTranslateConfig,
} from "../src/modules/translate/config";

const prefix = "extensions.zotero.zotwanglele.";
const prefKeys = ["ai.profiles", "ai.activeProfileId", "translate.aiProfileId"];
const draft = (): SupplierDraft => ({
  supplier: "示例供应商",
  temperature: 70,
  maxTokens: 4096,
  keys: [
    {
      baseUrl: "https://example.com/v1",
      apiKey: "key-a",
      format: "chat-completions",
      models: ["alpha", "shared"],
    },
    {
      baseUrl: "https://example.com/v1",
      apiKey: "key-b",
      format: "chat-completions",
      models: ["beta", "shared"],
    },
  ],
});

describe("supplier models", function () {
  let prefs: unknown[];
  let request: typeof Zotero.HTTP.request;

  beforeEach(function () {
    prefs = prefKeys.map((key) => Zotero.Prefs.get(prefix + key, true));
    request = Zotero.HTTP.request;
    saveProfiles([]);
    setActiveId("");
    Zotero.Prefs.clear(prefix + "translate.aiProfileId", true);
  });

  afterEach(function () {
    prefKeys.forEach((key, index) => {
      if (prefs[index] === undefined) Zotero.Prefs.clear(prefix + key, true);
      else (Zotero.Prefs as any).set(prefix + key, prefs[index], true);
    });
    Zotero.HTTP.request = request;
  });

  it("merges model display while preserving each key's routes on save and reopen", function () {
    const saved = saveSupplier(draft());
    assert.lengthOf(listProfiles(), 4);
    assert.deepEqual(
      listModelProfiles().map((p) => p.model),
      ["alpha", "shared", "beta"],
    );
    assert.equal(
      listModelProfiles().find((p) => p.model === "beta")?.apiKey,
      "key-b",
    );
    assert.deepEqual(getSupplierDraft(saved), draft());
    const ids = listProfiles().map((p) => p.id);
    saveSupplier(getSupplierDraft(saved), draft().supplier);
    assert.deepEqual(
      listProfiles().map((p) => p.id),
      ids,
    );
  });

  it("moves a merged model together with all its key routes", function () {
    saveSupplier(draft());
    const selected = listModelProfiles().find((p) => p.model === "shared")!;
    assert.isTrue(moveProfile(selected.id, 1));
    assert.deepEqual(
      listModelProfiles().map((p) => p.model),
      ["alpha", "beta", "shared"],
    );
    assert.equal(listProfiles().filter((p) => p.model === "shared").length, 2);
  });

  it("removes a key and remaps selected models to the remaining supporting key", function () {
    saveSupplier(draft());
    const selected = listProfiles().find(
      (p) => p.model === "shared" && p.apiKey === "key-a",
    )!;
    setActiveId(selected.id);
    Zotero.Prefs.set(prefix + "translate.aiProfileId", selected.id, true);
    const edited = draft();
    edited.keys.shift();
    saveSupplier(edited, edited.supplier);
    assert.lengthOf(listProfiles(), 2);
    assert.equal(
      listProfiles().find((p) => p.id === getActiveId())?.apiKey,
      "key-b",
    );
    assert.equal(loadTranslateConfig().aiModel, "shared");
    assert.equal(loadTranslateConfig().aiApiKey, "key-b");
  });

  it("filters translation-compatible routes before merging duplicate model names", function () {
    const value = draft();
    value.keys[0].format = "responses";
    saveSupplier(value);
    assert.deepEqual(
      getChatProfilesForTranslation().map((p) => p.model),
      ["beta", "shared"],
    );
    assert.isTrue(
      getChatProfilesForTranslation().every((p) => p.apiKey === "key-b"),
    );
  });

  it("merges into an existing supplier without losing its other keys", function () {
    saveSupplier(draft());
    const other = draft();
    other.supplier = "另一个供应商";
    other.keys = [{ ...other.keys[0], apiKey: "key-c", models: ["gamma"] }];
    saveSupplier(other);
    other.supplier = draft().supplier;
    saveSupplier(other, "另一个供应商");
    assert.lengthOf(listProfiles(), 5);
    assert.lengthOf(getSupplierDraft(listProfiles()[0]).keys, 3);
  });

  it("preserves keys whose model lists have not been fetched yet", function () {
    const value = draft();
    value.keys[0].models = [];
    const saved = saveSupplier(value);
    assert.lengthOf(getSupplierDraft(saved).keys, 2);
    assert.isFalse(listModelProfiles().some((p) => !p.model));
  });

  it("fetches each key with authorization and avoids duplicated v1 path segments", async function () {
    const calls: Array<{ method: string; url: string; key: string }> = [];
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options: any,
    ) => {
      calls.push({ method, url, key: options.headers.Authorization });
      return {
        status: 200,
        responseText: JSON.stringify({
          data: [{ id: "one" }, { id: "one" }, { id: "two" }, { id: null }],
        }),
      };
    };
    for (const baseUrl of [
      "https://example.com",
      "https://example.com/v1",
      "https://example.com/v1/",
    ]) {
      const client = new AiClient({
        baseUrl,
        apiKey: "test-only",
        model: "",
        format: "responses",
      });
      assert.deepEqual(await client.listModels(), ["one", "two"]);
    }
    assert.isTrue(
      calls.every(
        (call) =>
          call.method === "GET" &&
          call.url === "https://example.com/v1/models" &&
          call.key === "Bearer test-only",
      ),
    );
  });

  it("rejects authentication failures and malformed responses", async function () {
    const client = new AiClient({
      baseUrl: "https://example.com",
      apiKey: "test-only",
      model: "",
      format: "chat-completions",
    });
    for (const response of [
      { status: 401, responseText: "secret echoed by server" },
      { status: 200, responseText: "{}" },
      { status: 200, responseText: "html" },
    ]) {
      (Zotero.HTTP as any).request = async () => response;
      let failure: Error | undefined;
      try {
        await client.listModels();
      } catch (error) {
        failure = error as Error;
      }
      assert.instanceOf(failure, Error);
      assert.notInclude(failure!.message, "secret");
    }
  });
});
