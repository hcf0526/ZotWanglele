import {
  listModelProfiles,
  getSupplierName,
  subscribeProfiles,
} from "../ai/profiles";
import {
  getSettings,
  LANGUAGES,
  PROVIDERS,
  setSetting,
  TranslationSettings,
} from "./config";
import { tr } from "./locale";
import { ensureSelectionStyles } from "./styles";
import { element, selectControl } from "./view";

const mounts = new Map<Document, () => void>();

export function mountSelectionPreferences(
  doc: Document,
  host: Element,
): () => void {
  mounts.get(doc)?.();
  ensureSelectionStyles(doc);
  const settings = getSettings();
  const root = element(doc, "section");
  root.className = "zwl-selection-settings";
  root.id = "zwl-selection-settings";
  const grid = element(doc, "div");
  grid.className = "zwl-selection-settings-grid";
  const status = element(doc, "p");
  status.setAttribute("role", "status");
  const saved = <K extends keyof TranslationSettings>(
    key: K,
    value: TranslationSettings[K],
  ) => {
    setSetting(key, value);
    status.textContent = tr("settings-saved");
  };
  for (const key of ["enabled", "automatic"] as const) {
    const label = element(doc, "label");
    const input = element(doc, "input");
    input.type = "checkbox";
    input.checked = settings[key];
    input.dataset.pref = key;
    input.addEventListener("change", () => saved(key, input.checked));
    label.append(input, doc.createTextNode(tr(key)));
    grid.appendChild(label);
  }
  const choice = (
    key: keyof TranslationSettings,
    choices: readonly string[],
    labels: (id: string) => string,
  ) => {
    const field = selectControl(doc, tr(key), choices, labels);
    field.select.value = String(settings[key]);
    field.select.dataset.pref = key;
    field.select.addEventListener("change", () =>
      saved(key, field.select.value as any),
    );
    grid.appendChild(field.label);
    return field;
  };
  const provider = choice("provider", PROVIDERS, (id) => tr(`provider-${id}`));
  choice("sourceLang", ["auto", ...LANGUAGES], (id) => tr(`lang-${id}`));
  choice("targetLang", LANGUAGES, (id) => tr(`lang-${id}`));
  const profiles = choice("aiProfileId", [""], () => tr("follow-active"));
  profiles.label.dataset.provider = "ai";
  const refreshProfiles = () => {
    const selected = getSettings().aiProfileId;
    profiles.select.replaceChildren();
    const active = element(doc, "option", tr("follow-active"));
    active.value = "";
    profiles.select.appendChild(active);
    for (const profile of listModelProfiles()) {
      const option = element(
        doc,
        "option",
        `${getSupplierName(profile)} · ${profile.model || tr("no-model")}`,
      );
      option.value = profile.id;
      profiles.select.appendChild(option);
    }
    if (
      selected &&
      !Array.from(profiles.select.options).some(
        (option) => (option as HTMLOptionElement).value === selected,
      )
    ) {
      const missing = element(doc, "option", tr("missing-model"));
      missing.value = selected;
      profiles.select.appendChild(missing);
    }
    profiles.select.value = selected;
  };
  refreshProfiles();
  const plan = choice(
    "deeplPlan",
    ["free", "pro"],
    (id) => `DeepL API ${id === "free" ? "Free" : "Pro"}`,
  );
  plan.label.dataset.provider = "deepl";
  for (const key of ["deeplKey", "baiduAppId", "baiduKey"] as const) {
    const label = element(doc, "label", tr(key));
    label.dataset.provider = key.startsWith("deepl") ? "deepl" : "baidu";
    const input = element(doc, "input");
    input.type = key.endsWith("Key") ? "password" : "text";
    input.autocomplete = "off";
    input.setAttribute("aria-label", tr(key));
    input.value = settings[key];
    input.dataset.pref = key;
    input.addEventListener("change", () => saved(key, input.value.trim()));
    label.appendChild(input);
    grid.appendChild(label);
  }
  const google = element(doc, "p", tr("google-hint"));
  google.className = "zwl-selection-setting-wide";
  google.dataset.provider = "google";
  grid.appendChild(google);
  const showProvider = () => {
    for (const node of grid.querySelectorAll<HTMLElement>("[data-provider]"))
      node.hidden = node.dataset.provider !== provider.select.value;
  };
  provider.select.addEventListener("change", showProvider);
  showProvider();
  root.append(
    element(doc, "h3", tr("settings-title")),
    element(doc, "p", tr("settings-hint")),
    grid,
    status,
  );
  host.appendChild(root);
  const win = doc.defaultView;
  win?.addEventListener("focus", refreshProfiles);
  const unsubscribeProfiles = subscribeProfiles(refreshProfiles);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeProfiles();
    win?.removeEventListener("focus", refreshProfiles);
    win?.removeEventListener("unload", cleanup);
    root.remove();
    mounts.delete(doc);
  };
  win?.addEventListener("unload", cleanup, { once: true });
  mounts.set(doc, cleanup);
  return cleanup;
}

export function unmountSelectionPreferences(): void {
  for (const cleanup of [...mounts.values()]) cleanup();
}
