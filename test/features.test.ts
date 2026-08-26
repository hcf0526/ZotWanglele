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
import {
  addTask,
  clearFinishedTaskRecords,
  getTasks,
  subscribe,
  updateTask,
  type TaskRecord,
} from "../src/modules/tasks/task-store";
import {
  applyMetadataFields,
  buildMetadataDiffs,
  fetchCrossrefMetadata,
  formatDateParts,
  normalizeDoi,
  parseCrossrefMessage,
  setCrossrefMetadataInExtra,
  stripXml,
} from "../src/modules/metadata";

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

  it("stores unified task records and removes terminal records", function () {
    const record = addTask<TaskRecord>({
      kind: "metadata-update",
      title: "更新文献信息",
      itemIds: [101, 102],
      itemTitles: ["第一篇文献", "第二篇文献"],
      summary: "共 2 篇文献",
    });
    const snapshots: TaskRecord[][] = [];
    const unsubscribe = subscribe((tasks) => snapshots.push(tasks));

    try {
      assert.equal(record.status, "pending");
      assert.equal(record.progress, 0);
      assert.includeMembers(
        getTasks().map((task) => task.id),
        [record.id],
      );

      updateTask(record.id, {
        status: "partial",
        progress: 100,
        step: "完成",
        summary: "更新 1，失败 1",
        finishedAt: Date.now(),
      });
      const updated = getTasks().find((task) => task.id === record.id);
      assert.equal(updated?.status, "partial");
      assert.equal(updated?.summary, "更新 1，失败 1");
      assert.isAtLeast(snapshots.length, 2);

      clearFinishedTaskRecords();
      assert.isUndefined(getTasks().find((task) => task.id === record.id));
    } finally {
      unsubscribe();
      clearFinishedTaskRecords();
    }
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

  it("normalizes DOI values and parses Crossref response fields", function () {
    assert.equal(
      normalizeDoi(" https://doi.org/10.1234/Example.1. "),
      "10.1234/Example.1",
    );
    assert.equal(normalizeDoi("doi: 10.1234/example"), "10.1234/example");
    assert.equal(
      stripXml("<jats:p>A &amp; B &#x2014; test</jats:p>"),
      "A & B — test",
    );
    assert.equal(formatDateParts(["2024", "6", "2"]), "2024-06-02");
    assert.equal(formatDateParts([2024]), "2024");
    assert.equal(formatDateParts([2024, 13, 1]), "2024");
    assert.equal(formatDateParts([2024, 2, 30]), "2024-02");

    const metadata = parseCrossrefMessage({
      DOI: "10.5555/demo",
      title: ["<i>Example</i> article"],
      author: [
        { given: "Ada", family: "Lovelace" },
        { name: "Example Research Group" },
      ],
      abstract: "<jats:p>Useful &amp; clear.</jats:p>",
      issued: { "date-parts": [[2024, 6, 2]] },
    });
    assert.equal(metadata.title, "Example article");
    assert.equal(metadata.abstract, "Useful & clear.");
    assert.equal(metadata.date, "2024-06-02");
    assert.equal(metadata.authors.length, 2);
    assert.equal(metadata.authors[1].name, "Example Research Group");
  });

  it("sends the Crossref mailto and User-Agent with DOI requests", async function () {
    const originalRequest = (Zotero.HTTP as any).request;
    let captured:
      | { method: string; url: string; options: Record<string, any> }
      | undefined;
    (Zotero.HTTP as any).request = async (
      method: string,
      url: string,
      options: Record<string, any>,
    ) => {
      captured = { method, url, options };
      return {
        status: 200,
        responseText: JSON.stringify({
          message: {
            DOI: "10.5555/demo",
            title: ["Demo title"],
          },
        }),
      };
    };

    try {
      const metadata = await fetchCrossrefMetadata(
        "https://doi.org/10.5555/demo",
      );
      assert.equal(metadata.doi, "10.5555/demo");
      assert.equal(captured?.method, "GET");
      assert.include(captured?.url ?? "", "10.5555%2Fdemo");
      assert.include(captured?.url ?? "", "mailto=2971130350%40qq.com");
      assert.equal(
        captured?.options.headers["User-Agent"],
        "ZotWanglele (mailto:2971130350@qq.com)",
      );
      assert.equal(captured?.options.successCodes, false);
    } finally {
      (Zotero.HTTP as any).request = originalRequest;
    }
  });

  it("retries a transient HTTP rejection", async function () {
    this.timeout(5000);
    const originalRequest = (Zotero.HTTP as any).request;
    let calls = 0;
    (Zotero.HTTP as any).request = async () => {
      calls++;
      if (calls === 1) {
        const error: any = new Error("rate limited");
        error.statusCode = 429;
        throw error;
      }
      return {
        status: 200,
        responseText: JSON.stringify({
          message: { DOI: "10.5555/retry", title: ["Retry title"] },
        }),
      };
    };

    try {
      const metadata = await fetchCrossrefMetadata("10.5555/retry");
      assert.equal(metadata.title, "Retry title");
      assert.equal(calls, 2);
    } finally {
      (Zotero.HTTP as any).request = originalRequest;
    }
  });

  it("preserves Extra metadata while updating Crossref tracking lines", function () {
    const extra = setCrossrefMetadataInExtra(
      "Citation Key: demo\nZotWanglele-Crossref-Mailto: old@example.com\nNote: keep",
      "2026-01-02T03:04:05.000Z",
    );
    assert.include(extra, "Citation Key: demo");
    assert.include(extra, "Note: keep");
    assert.include(
      extra,
      "ZotWanglele-Crossref-Updated: 2026-01-02T03:04:05.000Z",
    );
    assert.include(extra, "ZotWanglele-Crossref-Mailto: 2971130350@qq.com");
    assert.equal(extra.match(/ZotWanglele-Crossref-Updated:/g)?.length, 1);
    assert.equal(extra.match(/ZotWanglele-Crossref-Mailto:/g)?.length, 1);
  });

  it("builds field diffs and applies only selected metadata fields", async function () {
    const fields: Record<string, string> = {
      title: "Old title",
      abstractNote: "Old abstract",
      DOI: "10.5555/old",
      date: "2020",
      extra: "Citation Key: demo",
    };
    let creators: any[] = [
      { creatorType: "author", firstName: "Old", lastName: "Author" },
    ];
    const item = {
      getField(field: string) {
        return fields[field] ?? "";
      },
      setField(field: string, value: string) {
        fields[field] = value;
      },
      getCreatorsJSON() {
        return creators;
      },
      setCreators(value: any[]) {
        creators = value;
      },
      async saveTx() {},
      isRegularItem() {
        return true;
      },
    } as unknown as Zotero.Item;
    const metadata = {
      doi: "10.5555/new",
      title: "New title",
      authors: [{ given: "Ada", family: "Lovelace" }],
      abstract: "New abstract",
      date: "2024-06-02",
    };

    const diffs = buildMetadataDiffs(item, metadata);
    assert.sameMembers(
      diffs.map((diff) => diff.field),
      ["title", "authors", "abstractNote", "DOI", "date"],
    );

    const applied = await applyMetadataFields(item, metadata, ["title", "DOI"]);
    assert.deepEqual(applied.applied, ["title", "DOI"]);
    assert.equal(fields.title, "New title");
    assert.equal(fields.DOI, "10.5555/new");
    assert.equal(fields.abstractNote, "Old abstract");
    assert.equal(creators[0].lastName, "Author");
    assert.include(fields.extra, "Citation Key: demo");
    assert.include(fields.extra, "ZotWanglele-Crossref-Updated:");
    assert.include(
      fields.extra,
      "ZotWanglele-Crossref-Mailto: 2971130350@qq.com",
    );
  });

  it("keeps non-author creators when author metadata is accepted", async function () {
    const fields: Record<string, string> = { extra: "" };
    let creators: any[] = [
      { creatorType: "author", firstName: "Old", lastName: "Author" },
      { creatorType: "editor", firstName: "Editorial", lastName: "Person" },
    ];
    const item = {
      getField(field: string) {
        return fields[field] ?? "";
      },
      setField(field: string, value: string) {
        fields[field] = value;
      },
      getCreatorsJSON() {
        return creators;
      },
      setCreators(value: any[]) {
        creators = value;
      },
      async saveTx() {},
    } as unknown as Zotero.Item;
    await applyMetadataFields(
      item,
      {
        doi: "",
        title: "",
        authors: [{ given: "Ada", family: "Lovelace" }],
        abstract: "",
        date: "",
      },
      ["authors"],
    );
    assert.equal(creators.length, 2);
    assert.equal(creators[0].lastName, "Lovelace");
    assert.equal(creators[1].creatorType, "editor");
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
