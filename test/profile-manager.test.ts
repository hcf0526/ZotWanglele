import { assert } from "chai";
import { config } from "../package.json";
import { mountProfileManager } from "../src/modules/ai/profile-manager";
import { openDashboard } from "../src/modules/dashboard/dashboard";
import {
  getActiveId,
  getProfile,
  getSupplierDraft,
  listProfiles,
  listModelProfiles,
  saveProfiles,
  setActiveId,
  type ApiProfile,
} from "../src/modules/ai/profiles";

describe("AI configuration surfaces", function () {
  it("shares model selection, explicit activation and ordering across both windows", async function () {
    this.timeout(15_000);
    const keys = ["ai.profiles", "ai.activeProfileId"].map(
      (key) => `${config.prefsPrefix}.${key}`,
    );
    const original = keys.map((key) => Zotero.Prefs.get(key, true));
    const profile = (id: string, supplier = "供应商甲"): ApiProfile => ({
      id,
      supplier,
      name: id,
      model: id,
      provider: "custom",
      baseUrl: "https://example.com/v1",
      apiKey: "test-only",
      format: "chat-completions",
      temperature: 70,
      maxTokens: 4096,
    });
    saveProfiles([
      profile("alpha"),
      profile("beta"),
      profile("gamma", "供应商乙"),
    ]);
    setActiveId("alpha");
    const main = Zotero.getMainWindow();
    const host = main.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    main.document.documentElement!.appendChild(host);
    let cleanup = mountProfileManager(main, host);
    const dashboard = openDashboard(main, "ai")!;
    try {
      await waitFor(
        () => dashboard.document.querySelectorAll(".zwl-ai-model").length === 3,
      );
      cleanup = mountProfileManager(main, host);
      assert.lengthOf(host.querySelectorAll(".zwl-ai-manager"), 1);
      const list = host.querySelector("richlistbox") as any;
      list.selectedItem = host.querySelector('[value="beta"]');
      assert.equal(
        getActiveId(),
        "alpha",
        "selecting a row should keep the current model",
      );
      (host.querySelector('[id$="-profile-use"]') as any).doCommand();
      await waitFor(
        () =>
          dashboard.document
            .querySelector('.zwl-ai-model[value="beta"]')
            ?.getAttribute("data-active") === "true",
      );
      assert.equal(getActiveId(), "beta");
      assert.equal(
        dashboard.document.getElementById("zwl-overview-model")?.textContent,
        "供应商甲/beta",
      );
      assert.isTrue(
        (host.querySelector('[id$="-profile-use"]') as any).disabled,
      );

      (host.querySelector('[id$="-profile-up"]') as any).doCommand();
      assert.deepEqual(
        listModelProfiles().map((p) => p.id),
        ["beta", "alpha", "gamma"],
      );
      await waitFor(
        () =>
          dashboard.document
            .querySelector(".zwl-ai-model")
            ?.getAttribute("value") === "beta",
      );
      const dashboardList = dashboard.document.querySelector(
        ".zwl-ai-list",
      ) as any;
      dashboardList.selectedItem =
        dashboard.document.querySelector('[value="alpha"]');
      (
        dashboard.document.querySelector('[id$="-profile-use"]') as any
      ).doCommand();
      await waitFor(
        () =>
          host
            .querySelector('.zwl-ai-model[value="alpha"]')
            ?.getAttribute("data-active") === "true",
      );
      assert.equal(getActiveId(), "alpha");
      assert.lengthOf(
        dashboard.document.querySelectorAll(
          '#zwl-selection-settings [data-pref="aiProfileId"] option',
        ),
        4,
      );

      const server = dashboard.document.getElementById(
        "zwl-server-url",
      ) as HTMLInputElement;
      server.value = "https://example.com/unsaved";
      saveProfiles([...listModelProfiles(), profile("delta")]);
      await waitFor(
        () =>
          dashboard.document.querySelectorAll(
            '#zwl-selection-settings [data-pref="aiProfileId"] option',
          ).length === 5,
      );
      assert.lengthOf(
        dashboard.document.querySelectorAll("#zwl-service option"),
        4,
      );
      assert.equal(
        server.value,
        "https://example.com/unsaved",
        "model changes preserve unsaved translation fields",
      );

      cleanup();
      setActiveId("gamma");
      assert.lengthOf(
        host.children,
        0,
        "unmount removes the settings UI and its observers",
      );
    } finally {
      cleanup();
      dashboard.close();
      host.remove();
      keys.forEach((key, index) => {
        const value = original[index];
        if (value === undefined) Zotero.Prefs.clear(key, true);
        else Zotero.Prefs.set(key, value, true);
      });
    }
  });

  for (const surface of ["dashboard", "preferences"] as const) {
    // Each case uses the native window and its actual modal commands.
    it(`loads and preserves saved keys through the ${surface} supplier dialogs`, async function () {
      this.timeout(20_000);
      const keys = ["ai.profiles", "ai.activeProfileId"].map(
        (key) => `${config.prefsPrefix}.${key}`,
      );
      const original = keys.map((key) => Zotero.Prefs.get(key, true));
      const first: ApiProfile = {
        id: "dialog-alpha",
        supplier: "多 Key 供应商",
        name: "alpha",
        model: "alpha",
        provider: "custom",
        baseUrl: "https://example.com/v1",
        apiKey: "test-first-key",
        format: "chat-completions",
        temperature: 45,
        maxTokens: 6144,
      };
      const second: ApiProfile = {
        ...first,
        id: "dialog-gamma",
        name: "gamma",
        model: "gamma",
        baseUrl: "https://example.org/v1",
        apiKey: "test-second-key",
        format: "responses",
      };
      saveProfiles([
        first,
        { ...first, id: "dialog-beta", name: "beta", model: "beta" },
        second,
        { ...first, id: "dialog-other", supplier: "保留供应商" },
      ]);
      setActiveId(first.id);
      const stored = listProfiles();
      const pane = Zotero.PreferencePanes.pluginPanes.find(
        (item) => item.pluginID === config.addonID,
      )!;
      const parent = (
        surface === "dashboard"
          ? openDashboard(Zotero.getMainWindow(), "ai")
          : Zotero.Utilities.Internal.openPreferences(pane.id)
      ) as Window;
      try {
        await waitFor(
          () => parent.document.querySelectorAll(".zwl-ai-model").length === 4,
        );
        const list = parent.document.querySelector(".zwl-ai-list") as any;
        list.selectedItem = parent.document.querySelector(
          `[value="${first.id}"]`,
        );
        const checkEditor = (win: Window) => {
          const doc = win.document;
          const input = (id: string) =>
            doc.getElementById(`zwl-editor-${id}`) as HTMLInputElement;
          assert.equal(input("supplier").value, first.supplier);
          assert.equal(input("temperature").value, "45");
          assert.equal(input("maxTokens").value, "6144");
          const cards = [...doc.querySelectorAll(".zwl-key-card")];
          assert.lengthOf(cards, 2);
          for (const [index, profile] of [first, second].entries()) {
            assert.equal(
              cards[index].querySelector<HTMLInputElement>('input[type="url"]')!
                .value,
              profile.baseUrl,
            );
            const secret = cards[index].querySelector<HTMLInputElement>(
              'input[type="password"]',
            )!;
            assert.equal(secret.value, profile.apiKey);
            assert.equal(
              cards[index].querySelector("select")!.value,
              profile.format,
            );
            assert.equal(
              cards[index].querySelector("textarea")!.value,
              index === 0 ? "alpha\nbeta" : "gamma",
            );
          }
          return { input, cards };
        };

        commandWithDialog(parent, "edit", "profile-editor", (win) => {
          checkEditor(win).input("supplier").value = "未保存的修改";
          (win.document.getElementById("zwl-editor-cancel") as any).doCommand();
        });
        assert.deepEqual(
          listProfiles(),
          stored,
          "cancel preserves all stored keys",
        );

        commandWithDialog(parent, "edit", "profile-editor", (win) => {
          const { cards, input } = checkEditor(win);
          cards[0].querySelector("textarea")!.value += "\ndelta";
          input("maxTokens").value = "8192";
          (win.document.getElementById("zwl-editor-save") as any).doCommand();
        });
        const saved = getSupplierDraft(getProfile(first.id)!);
        assert.deepEqual(saved.keys, [
          {
            apiKey: first.apiKey,
            baseUrl: first.baseUrl,
            format: first.format,
            models: ["alpha", "beta", "delta"],
          },
          {
            apiKey: second.apiKey,
            baseUrl: second.baseUrl,
            format: second.format,
            models: ["gamma"],
          },
        ]);
        assert.equal(saved.maxTokens, 8192);
        assert.equal(getActiveId(), first.id);
        await waitFor(
          () => parent.document.querySelectorAll(".zwl-ai-model").length === 5,
        );

        const afterSave = listProfiles();
        commandWithDialog(parent, "delete", "confirm-dialog", (win) => {
          assert.match(
            win.document.getElementById("zwl-confirm-title")!.textContent!,
            /删除供应商|Delete provider/,
          );
          (
            win.document.getElementById("zwl-confirm-cancel") as any
          ).doCommand();
        });
        assert.deepEqual(listProfiles(), afterSave);
        commandWithDialog(parent, "delete", "confirm-dialog", (win) => {
          (win.document.getElementById("zwl-confirm-apply") as any).doCommand();
        });
        assert.deepEqual(
          listProfiles(),
          stored.filter((profile) => profile.id === "dialog-other"),
        );
      } finally {
        parent.close();
        keys.forEach((key, index) => {
          const value = original[index];
          if (value === undefined) Zotero.Prefs.clear(key, true);
          else Zotero.Prefs.set(key, value, true);
        });
      }
    });
  }
});

/** Drive the real modal action, including its XHTML load hook and opener. */
function commandWithDialog(
  parent: Window,
  command: string,
  type: string,
  interact: (win: Window) => void,
): void {
  let opened = false;
  let failure: unknown;
  const observer = {
    observe(subject: any, topic: string) {
      if (topic !== "domwindowopened") return;
      const win = subject as Window;
      win.addEventListener(
        "load",
        () => {
          if (
            win.document.documentElement?.getAttribute("windowtype") !==
            `zotwanglele:${type}`
          )
            return;
          win.setTimeout(() => {
            opened = true;
            try {
              assert.equal(win.opener, parent);
              interact(win);
            } catch (error) {
              failure = error;
            } finally {
              if (!win.closed) win.close();
            }
          }, 0);
        },
        { once: true },
      );
    },
  };
  Services.ww.registerNotification(observer);
  try {
    (
      parent.document.querySelector(`[id$="-profile-${command}"]`) as any
    ).doCommand();
    if (failure) throw failure;
    assert.isTrue(opened, `${command} should open its dialog`);
  } finally {
    Services.ww.unregisterNotification(observer);
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await Zotero.Promise.delay(50);
  }
  assert.fail("AI configuration UI did not update");
}
