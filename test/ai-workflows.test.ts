import { assert } from "chai";
import { config } from "../package.json";
import { generateLiteratureReview } from "../src/modules/review/review-generator";
import { translateItemTitle } from "../src/modules/title-translate/title-translation";

const PREF_PREFIX = `extensions.zotero.${config.addonRef}.`;

describe("AI literature workflows", function () {
  this.timeout(20_000);

  const originalPrefs = new Map<string, unknown>();
  const createdItems: Zotero.Item[] = [];
  let originalRequest: any;

  before(async function () {
    for (const key of ["ai.profiles", "ai.activeProfileId"]) {
      originalPrefs.set(
        key,
        (Zotero.Prefs as any).get(PREF_PREFIX + key, true),
      );
    }

    const profile = {
      id: "test-ai-profile",
      name: "Test AI",
      provider: "custom",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "test-key",
      model: "test-model",
      format: "chat-completions",
      temperature: 20,
      maxTokens: 1024,
    };
    setPref("ai.profiles", JSON.stringify([profile]));
    setPref("ai.activeProfileId", profile.id);

    originalRequest = (Zotero.HTTP as any).request;
    (Zotero.HTTP as any).request = async (
      _method: string,
      _url: string,
      options: { body?: string },
    ) => {
      const body = JSON.parse(options.body || "{}");
      const userContent = body.messages?.find(
        (message: { role: string }) => message.role === "user",
      )?.content;
      const content = String(userContent).includes("生成一段文献综述")
        ? "# 综合分析\n\n两篇文献共同讨论了测试方法，并呈现互补结论。"
        : "测试论文的中文标题";
      return {
        status: 200,
        statusText: "OK",
        responseText: JSON.stringify({
          choices: [{ message: { content } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
          },
        }),
      };
    };

    createdItems.push(
      await createItem(
        "A Test Paper for Translation",
        "This paper introduces the first testing method.",
      ),
      await createItem(
        "A Companion Study",
        "This study evaluates a complementary method.",
      ),
    );
  });

  after(async function () {
    (Zotero.HTTP as any).request = originalRequest;
    for (const item of [...createdItems].reverse()) {
      try {
        await item.eraseTx();
      } catch {
        // A failed assertion may leave an item already removed.
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

  it("translates a title, persists Extra and supplies the Zotero column", async function () {
    const item = createdItems[0];
    const result = await translateItemTitle(item);
    assert.isTrue(result.ok, result.message);
    assert.equal(result.translatedTitle, "测试论文的中文标题");

    const reloaded = (await Zotero.Items.getAsync(item.id)) as Zotero.Item;
    assert.include(
      reloaded.getField("extra") as string,
      "ZotWanglele-Translated-Title: 测试论文的中文标题",
    );

    const columns = (Zotero.ItemTreeManager as any).getCustomColumns(
      undefined,
      { pluginID: config.addonID },
    ) as Array<{ dataKey: string }>;
    const column = columns.find(({ dataKey }) =>
      dataKey.endsWith("translatedTitle"),
    );
    assert.exists(column);
    assert.equal(
      Zotero.ItemTreeManager.getCustomCellData(reloaded, column!.dataKey),
      "测试论文的中文标题",
    );
  });

  it("generates and saves a standalone literature review note", async function () {
    const result = await generateLiteratureReview(createdItems);
    assert.isTrue(result.ok, result.message);
    assert.isNumber(result.noteId);

    const note = (await Zotero.Items.getAsync(result.noteId!)) as Zotero.Item;
    createdItems.push(note);
    assert.isTrue(note.isNote());
    assert.include(note.getNote(), "ZotWanglele · 文献综述");
    assert.include(note.getNote(), "两篇文献共同讨论了测试方法");
    assert.equal(note.libraryID, createdItems[0].libraryID);
  });
});

async function createItem(
  title: string,
  abstract: string,
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setField("abstractNote", abstract);
  await item.saveTx();
  return item;
}

function setPref(key: string, value: unknown): void {
  (Zotero.Prefs as any).set(PREF_PREFIX + key, value, true);
}
