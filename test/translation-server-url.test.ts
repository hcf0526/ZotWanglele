import { assert } from "chai";
import { normalizeServerAiBaseUrl } from "../src/modules/translate/translator";

describe("server translation URL", function () {
  it("adds the OpenAI-compatible v1 path for pdf2zh_next", function () {
    assert.equal(
      normalizeServerAiBaseUrl({
        aiBaseUrl: "https://zzone.cc.cd",
      }),
      "https://zzone.cc.cd/v1",
    );
  });

  it("keeps an existing v1 path and migrates legacy server URLs", function () {
    assert.equal(
      normalizeServerAiBaseUrl({
        aiBaseUrl: "https://zzone.cc.cd/v1/",
      }),
      "https://zzone.cc.cd/v1",
    );
    assert.equal(
      normalizeServerAiBaseUrl({
        aiBaseUrl: "https://example.com/root/",
      }),
      "https://example.com/root/v1",
    );
  });
});
