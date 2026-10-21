import { assert } from "chai";
import {
  getSupplierName,
  isValidBaseUrl,
  groupProfilesBySupplier,
  listProfiles,
  moveProfile,
  saveProfiles,
  updateProfile,
  type ApiProfile,
} from "../src/modules/ai/profiles";

const prefKey = "extensions.zotero.zotwanglele.ai.profiles";

function profile(id: string, supplier?: string): ApiProfile {
  return {
    id,
    name: id,
    supplier,
    provider: "custom",
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: id,
    format: "responses",
    temperature: 70,
    maxTokens: 4096,
  };
}

describe("profile suppliers", function () {
  let original: unknown;

  beforeEach(function () {
    original = Zotero.Prefs.get(prefKey, true);
  });

  afterEach(function () {
    if (original === undefined) Zotero.Prefs.clear(prefKey, true);
    else (Zotero.Prefs as any).set(prefKey, original, true);
  });

  it("keeps legacy provider labels and honors an explicitly empty supplier", function () {
    assert.equal(
      getSupplierName({ ...profile("a"), provider: "openai" }),
      "OpenAI",
    );
    assert.equal(getSupplierName(profile("b")), "");
    assert.equal(
      getSupplierName({ ...profile("c", ""), provider: "openai" }),
      "",
    );
  });

  it("groups interleaved models by trimmed supplier rather than legacy preset", function () {
    const a = profile("a", "供应商甲");
    const b = profile("b", "供应商乙");
    const c = { ...profile("c", " 供应商甲 "), provider: "openai" };
    const groups = groupProfilesBySupplier([a, b, c]);
    assert.deepEqual([...groups.keys()], ["供应商甲", "供应商乙"]);
    assert.deepEqual(
      groups.get("供应商甲")?.map((p) => p.id),
      ["a", "c"],
    );
  });

  it("persists supplier edits while preserving credentials and model settings", function () {
    const originalProfile = profile("a", "供应商甲");
    saveProfiles([originalProfile]);
    assert.isTrue(updateProfile("a", { supplier: "供应商乙" }));
    assert.deepEqual(listProfiles(), [
      { ...originalProfile, supplier: "供应商乙" },
    ]);
  });

  it("requires the Base URL to end with /v1 and migrates legacy roots", function () {
    assert.isTrue(isValidBaseUrl("https://example.com/v1"));
    assert.isTrue(isValidBaseUrl("http://localhost:11434/v1/"));
    assert.isFalse(isValidBaseUrl("https://example.com"));
    assert.isFalse(isValidBaseUrl("https://example.com/v1/models"));

    const legacy = profile("legacy");
    (legacy as any).baseUrl = "https://legacy.example";
    Zotero.Prefs.set(prefKey, JSON.stringify([legacy]), true);
    assert.equal(listProfiles()[0].baseUrl, "https://legacy.example/v1");
    const stored = JSON.parse(Zotero.Prefs.get(prefKey, true) as string);
    assert.equal(stored[0].baseUrl, "https://legacy.example/v1");
  });

  it("moves within a supplier group across interleaved profiles", function () {
    saveProfiles([profile("a", "甲"), profile("b", "乙"), profile("c", "甲")]);
    assert.isTrue(moveProfile("a", 1));
    assert.deepEqual(
      listProfiles().map((p) => p.id),
      ["c", "b", "a"],
    );
    assert.isFalse(moveProfile("a", 1));
    assert.isFalse(moveProfile("b", -1));
    assert.isTrue(moveProfile("a", -1));
    assert.deepEqual(
      listProfiles().map((p) => p.id),
      ["a", "b", "c"],
    );
  });
});
