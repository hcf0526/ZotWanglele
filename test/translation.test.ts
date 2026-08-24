import { assert } from "chai";
import { config } from "../package.json";

const PREF_PREFIX = `extensions.zotero.${config.addonRef}.`;
const TEST_TITLE = `ZotWanglele translation test ${Date.now()}`;

describe("PDF translation workflow", function () {
  this.timeout(180_000);

  let item: Zotero.Item | null = null;
  const originalPrefs = new Map<string, unknown>();
  const changedPrefs = [
    "translate.envSource",
    "translate.serverUrl",
    "translate.engine",
    "translate.outputs",
    "translate.langIn",
    "translate.langOut",
    "translate.service",
    "translate.threads",
  ];

  before(async function () {
    const pdfPath = Services.env.get("ZOTWANGLELE_TEST_PDF");
    if (!pdfPath || !(await fileExists(pdfPath))) {
      this.skip();
      return;
    }

    const health = await fetch("http://127.0.0.1:9999/health");
    assert.isTrue(health.ok, "pdf2zh /health should respond successfully");

    for (const key of changedPrefs) {
      originalPrefs.set(
        key,
        (Zotero.Prefs as any).get(PREF_PREFIX + key, true),
      );
    }

    setPref("translate.envSource", "server");
    setPref("translate.serverUrl", "http://127.0.0.1:9999");
    setPref("translate.engine", "pdf2zh");
    setPref("translate.outputs", "mono,dual");
    setPref("translate.langIn", "auto");
    setPref("translate.langOut", "zh");
    setPref("translate.service", "google");
    setPref("translate.threads", 4);

    item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", TEST_TITLE);
    await item.saveTx();

    await (Zotero.Attachments as any).importFromFile({
      file: pdfPath,
      parentItemID: item.id,
      title: "attentionisallyouneed04.pdf",
    });
  });

  after(async function () {
    const dashboard = Services.wm.getMostRecentWindow(
      "zotwanglele:dashboard",
    ) as Window | null;
    dashboard?.close();

    if (item?.id) {
      try {
        await item.eraseTx();
      } catch {
        // The temporary test profile is discarded even if cleanup is unavailable.
      }
    }

    for (const [key, value] of originalPrefs) {
      if (value === undefined || value === null) {
        (Zotero.Prefs as any).clear(PREF_PREFIX + key, true);
      } else {
        setPref(key, value);
      }
    }
  });

  it("should translate from the item menu and render progress", async function () {
    assert.isNotNull(item);

    const pane = (Zotero as any).getActiveZoteroPane();
    await pane.selectItem(item!.id);

    const menuItem = Zotero.getMainWindow().document.getElementById(
      "zotwanglele-itemmenu-translate",
    ) as any;
    assert.isNotNull(menuItem, "translation menu item should exist");
    menuItem.doCommand();

    const dashboard = await waitFor(
      () =>
        Services.wm.getMostRecentWindow(
          "zotwanglele:dashboard",
        ) as Window | null,
      10_000,
    );
    assert.isNotNull(dashboard, "dashboard should open from the menu command");

    const progressValues = new Set<number>();
    const finalText = await waitFor(
      () => {
        const text =
          dashboard!.document.getElementById("zotwanglele-queue-list")
            ?.textContent ?? "";
        if (!text.includes(TEST_TITLE)) return null;
        for (const match of text.matchAll(/(\d+)%/g)) {
          progressValues.add(Number(match[1]));
        }
        return text.includes("成功") && text.includes("100%") ? text : null;
      },
      150_000,
      250,
    );

    assert.include(finalText, TEST_TITLE);
    assert.include(finalText, "成功");
    assert.isTrue(
      [...progressValues].some((value) => value > 0 && value < 100),
      "dashboard should render progress before completion",
    );
    assert.isTrue(
      progressValues.has(100),
      "dashboard should render 100% progress",
    );

    const reloaded = (await Zotero.Items.getAsync(item!.id)) as Zotero.Item;
    const attachments = await Promise.all(
      reloaded
        .getAttachments(false)
        .map((id) => Zotero.Items.getAsync(id) as Promise<Zotero.Item>),
    );
    const titles = attachments.map(
      (attachment) => (attachment.getField("title") as string) || "",
    );
    assert.include(titles, `[翻译] ${TEST_TITLE}`);
    assert.include(titles, `[双语] ${TEST_TITLE}`);
  });
});

function setPref(key: string, value: unknown): void {
  (Zotero.Prefs as any).set(PREF_PREFIX + key, value, true);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await (IOUtils as any).stat(path);
    return true;
  } catch {
    return false;
  }
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
