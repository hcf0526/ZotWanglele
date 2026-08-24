import { assert } from "chai";
import {
  cleanTranslatedTitle,
  getTranslatedTitleFromExtra,
  setTranslatedTitleInExtra,
} from "../src/modules/title-translate/title-translation";
import { formatReviewSource } from "../src/modules/review/review-generator";
import {
  addCustomTemplate,
  deleteCustomTemplate,
  getCustomTemplates,
  loadCustomTemplates,
  PromptTemplate,
  updateCustomTemplate,
} from "../src/modules/ai/prompts";

describe("feature helpers", function () {
  let originalTemplates: PromptTemplate[] = [];

  before(function () {
    originalTemplates = getCustomTemplates();
  });

  after(function () {
    loadCustomTemplates(originalTemplates);
  });

  it("stores one translated title line while preserving Extra metadata", function () {
    const initial = "Citation Key: wang2026\nNote: retained";
    const created = setTranslatedTitleInExtra(initial, "  示例  标题  ");
    assert.include(created, "Citation Key: wang2026");
    assert.equal(getTranslatedTitleFromExtra(created), "示例 标题");

    const updated = setTranslatedTitleInExtra(created, "更新后的标题");
    assert.equal(getTranslatedTitleFromExtra(updated), "更新后的标题");
    assert.equal(updated.match(/ZotWanglele-Translated-Title:/g)?.length, 1);
  });

  it("normalizes common title translation wrappers", function () {
    assert.equal(
      cleanTranslatedTitle('```text\n译文："注意力机制"\n```'),
      "注意力机制",
    );
  });

  it("formats review sources with traceable item numbers", function () {
    const source = formatReviewSource(2, {
      title: "Attention Is All You Need",
      authors: "Vaswani et al.",
      year: "2017",
      abstract: "Transformer architecture.",
      doi: "10.0000/example",
    });
    assert.include(source, "## 文献 2");
    assert.include(source, "DOI：10.0000/example");
    assert.include(source, "Transformer architecture.");
  });

  it("persists custom prompt create, update and delete operations", function () {
    const id = `test-template-${Date.now()}`;
    addCustomTemplate({
      id,
      name: "测试模板",
      description: "测试持久化",
      systemPrompt: "系统内容",
      userPrompt: "用户内容 {{title}}",
    });
    assert.isTrue(getCustomTemplates().some((item) => item.id === id));
    assert.isTrue(updateCustomTemplate(id, { name: "更新模板" }));
    assert.equal(
      getCustomTemplates().find((item) => item.id === id)?.name,
      "更新模板",
    );
    assert.isTrue(deleteCustomTemplate(id));
    assert.isFalse(getCustomTemplates().some((item) => item.id === id));
  });
});
