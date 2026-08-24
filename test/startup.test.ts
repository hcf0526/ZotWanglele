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
    assert.isNotNull(doc.getElementById("zotwanglele-tb-dashboard"));
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
    } finally {
      dashboard!.close();
    }
  });
});

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
