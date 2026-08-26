import { assert } from "chai";
import { config } from "../package.json";
import { openDashboard } from "../src/modules/dashboard/dashboard";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should register item actions, translated title column and dashboard button", function () {
    const doc = Zotero.getMainWindow().document;
    assert.isNotNull(doc.getElementById("zotwanglele-itemmenu-translate"));
    assert.isNotNull(doc.getElementById("zotwanglele-itemmenu-review"));
    assert.isNotNull(
      doc.getElementById("zotwanglele-itemmenu-title-translate"),
    );
    assert.isNotNull(
      doc.getElementById("zotwanglele-itemmenu-metadata-update"),
    );
    assert.isNotNull(doc.getElementById("zotwanglele-tb-dashboard"));
    assert.exists(getNotePreviewSection());
    const columns = (Zotero.ItemTreeManager as any).getCustomColumns(
      undefined,
      { pluginID: config.addonID },
    ) as Array<{ dataKey: string }>;
    assert.isTrue(
      columns.some((column) => column.dataKey.endsWith("translatedTitle")),
    );
    const column = columns.find((item) =>
      item.dataKey.endsWith("translatedTitle"),
    )!;
    const item = new Zotero.Item("journalArticle");
    item.setField(
      "extra",
      "ZotWanglele-Translated-Title: 条目列表中的标题译文",
    );
    assert.equal(
      Zotero.ItemTreeManager.getCustomCellData(item, column.dataKey),
      "条目列表中的标题译文",
    );
  });

  it("should render the AI reading-note preview controls", async function () {
    this.timeout(15_000);
    const section = getNotePreviewSection();
    assert.exists(section);

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Preview panel paper");
    await item.saveTx();

    const note = new Zotero.Item("note");
    note.parentID = item.id;
    note.setNote(
      "<h1>ZotWanglele · 论文精读</h1><h2>研究方法</h2><p>侧栏预览正文</p>",
    );
    note.addTag("ZotWanglele-AI:paper-reading");
    await note.saveTx();

    const doc = Zotero.getMainWindow().document;
    const body = doc.createElement("div");
    doc.documentElement.appendChild(body);

    try {
      section.onRender({ body, item });
      const preview = await waitFor(
        () => body.querySelector(".zwl-note-preview-markdown"),
        5_000,
      );
      assert.isNotNull(preview);
      assert.include(preview?.textContent ?? "", "侧栏预览正文");
      assert.lengthOf(body.querySelectorAll(".zwl-note-preview-tab"), 2);
      assert.isNotNull(body.querySelector(".zwl-note-preview-font-controls"));
      assert.isNotNull(body.querySelector(".zwl-note-preview-resize-handle"));
      assert.include(
        body.querySelector(".zwl-note-preview-item-title")?.textContent ?? "",
        "Preview panel paper",
      );
    } finally {
      section.onDestroy?.({ body });
      body.remove();
      await item.eraseTx();
    }
  });

  it("should open and mount every dashboard panel", async function () {
    this.timeout(15_000);
    const dashboard = openDashboard(Zotero.getMainWindow(), "overview");
    assert.isNotNull(dashboard);

    try {
      const promptList = await waitFor(() => {
        const list = dashboard!.document.getElementById("zwl-prompt-list");
        return list && list.childElementCount > 0 ? list : null;
      }, 5_000);
      const doc = dashboard!.document;
      assert.isNotNull(doc.getElementById("zotwanglele-overview-root"));
      assert.isNotNull(doc.getElementById("zotwanglele-queue-root"));
      assert.isNotNull(doc.getElementById("zwl-prompt-form"));
      assert.isNotNull(doc.getElementById("zotwanglele-adv-root"));
      assert.isNotNull(promptList);
      const firstPrompt = promptList!.firstElementChild as HTMLElement;
      firstPrompt.click();
      const nameView = doc.getElementById("zwl-prompt-name-view");
      const descriptionView = doc.getElementById("zwl-prompt-description-view");
      assert.include(["DIV", "html:div"], nameView?.tagName);
      assert.include(["DIV", "html:div"], descriptionView?.tagName);
      assert.isNull(doc.querySelector("input#zwl-prompt-name"));
      assert.isNull(doc.querySelector("input#zwl-prompt-description"));
      assert.equal(nameView?.textContent, "论文精读");

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      const taskTitle = `Dashboard task card ${Date.now()}`;
      item.setField("title", taskTitle);
      await item.saveTx();

      try {
        const pane = (Zotero as any).getActiveZoteroPane();
        await pane.selectItem(item.id);
        const translateMenuItem =
          Zotero.getMainWindow().document.getElementById(
            "zotwanglele-itemmenu-translate",
          ) as any;
        assert.isNotNull(translateMenuItem);
        translateMenuItem.doCommand();

        const taskToggle = await waitFor(() => {
          return (Array.from(
            doc.querySelectorAll(".zwl-task-card-toggle"),
          ).find((element) => element.textContent?.includes(taskTitle)) ??
            null) as HTMLButtonElement | null;
        }, 5_000);
        assert.isNotNull(taskToggle);
        assert.equal(taskToggle?.getAttribute("aria-expanded"), "false");

        taskToggle!.click();
        const expandedToggle = doc.querySelector(
          ".zwl-task-card-toggle",
        ) as HTMLButtonElement | null;
        assert.equal(expandedToggle?.getAttribute("aria-expanded"), "true");
        const expandedDetails = expandedToggle?.parentElement?.querySelector(
          ".zwl-task-card-details",
        ) as HTMLElement | null;
        assert.isFalse(expandedDetails?.hidden ?? true);

        expandedToggle!.click();
        assert.equal(expandedToggle?.getAttribute("aria-expanded"), "false");
        assert.isTrue(expandedDetails?.hidden ?? false);
      } finally {
        (
          doc.getElementById(
            "zotwanglele-queue-clear",
          ) as HTMLButtonElement | null
        )?.click();
        await item.eraseTx();
      }
    } finally {
      dashboard!.close();
    }
  });
});

function getNotePreviewSection(): any {
  const sections = ((Zotero.ItemPaneManager as any).customSectionData
    ?.options ?? []) as Array<{ paneID?: string; pluginID?: string }>;
  return sections.find(
    (section) =>
      section.pluginID === config.addonID &&
      String(section.paneID).includes("zotwanglele-ai-notes"),
  );
}

async function waitFor<T>(
  getValue: () => T | Promise<T>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await getValue();
    if (value) return value;
    await Zotero.Promise.delay(intervalMs);
  }
  return null;
}
