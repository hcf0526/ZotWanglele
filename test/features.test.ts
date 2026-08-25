import { assert } from "chai";
import {
  cleanTranslatedTitle,
  getTranslatedTitleFromExtra,
  setTranslatedTitleInExtra,
} from "../src/modules/title-translate/title-translation";
import { formatReviewSource } from "../src/modules/review/review-generator";
import {
  findLatestReadingNote,
  getGeneratedNoteTag,
  resolveReadingParentItem,
} from "../src/modules/reader/reading-notes";
import {
  addCustomTemplate,
  deleteCustomTemplate,
  getBuiltinTemplateName,
  getCustomTemplates,
  getTemplate,
  loadCustomTemplates,
  PromptTemplate,
  updateBuiltinTemplate,
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

  it("keeps built-in names fixed while applying prompt overrides", function () {
    const original = getTemplate("paper-reading");
    assert.isDefined(original);
    assert.equal(getBuiltinTemplateName("paper-reading"), "论文精读");

    try {
      assert.isTrue(
        updateBuiltinTemplate("paper-reading", {
          systemPrompt: "测试系统提示词",
          userPrompt: "测试用户提示词 {{title}}",
        }),
      );
      const updated = getTemplate("paper-reading");
      assert.equal(updated?.name, "论文精读");
      assert.equal(updated?.systemPrompt, "测试系统提示词");
      assert.equal(updated?.userPrompt, "测试用户提示词 {{title}}");
    } finally {
      updateBuiltinTemplate("paper-reading", {
        systemPrompt: original!.systemPrompt,
        userPrompt: original!.userPrompt,
      });
    }
  });

  it("finds generated reading notes by template tag", async function () {
    const parent = new Zotero.Item("journalArticle");
    parent.libraryID = Zotero.Libraries.userLibraryID;
    parent.setField("title", "Reading preview test");
    await parent.saveTx();

    const note = new Zotero.Item("note");
    note.parentID = parent.id;
    note.setNote("<h1>ZotWanglele · 论文精读</h1><p>预览内容</p>");
    note.addTag(getGeneratedNoteTag("paper-reading"));
    await note.saveTx();

    try {
      const resolved = await resolveReadingParentItem(parent);
      const found = await findLatestReadingNote(parent, "paper-reading");
      assert.equal(resolved?.id, parent.id);
      assert.equal(found?.note.id, note.id);
      assert.include(found?.previewHtml ?? "", "预览内容");
    } finally {
      await parent.eraseTx();
    }
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
