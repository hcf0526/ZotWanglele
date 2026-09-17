import {
  getActiveId,
  listModelProfiles,
  getModelLabel,
  subscribeProfiles,
} from "../ai/profiles";
import {
  getSettings,
  getLengthRules,
  normalizeTargets,
  LANGUAGES,
  setSetting,
  TranslationSettings,
  TranslationTarget,
  LengthRule,
  validRule,
  PREF_PREFIX,
} from "./config";
import { tr } from "./locale";
import { ensureSelectionStyles } from "./styles";
import { element, selectControl } from "./view";
import { translationHistory } from "./history";

const mounts = new Map<Document, () => void>();

function targetPicker(
  doc: Document,
  read: () => TranslationTarget[],
  change: (targets: TranslationTarget[]) => void,
) {
  const root = element(doc, "div");
  root.className = "zwl-selection-targets";
  let refreshModels: (() => void)[] = [];
  const render = () => {
    root.replaceChildren();
    refreshModels = [];
    root.appendChild(element(doc, "h5", tr("service")));
    if (!read().length)
      root.appendChild(element(doc, "p", tr("targets-empty")));
    read().forEach((target, index) => {
      const row = element(doc, "div");
      row.className = "zwl-selection-target-row";
      const service = selectControl(
        doc,
        tr("service"),
        ["google", "ai", "deepl", "baidu"],
        (id) => tr(`provider-${id}`),
      );
      if (service.label.firstChild)
        service.label.removeChild(service.label.firstChild);
      service.select.dataset.field = "provider";
      service.select.value = target.provider;
      const model = selectControl(doc, tr("aiProfileId"), [], (id) => id);
      model.select.dataset.field = "aiProfileId";
      const refresh = () => {
        model.select.replaceChildren();
        const placeholder = element(doc, "option", tr("choose-model"));
        placeholder.value = "";
        model.select.appendChild(placeholder);
        for (const profile of listModelProfiles().filter((p) => p.model)) {
          const option = element(doc, "option", getModelLabel(profile));
          option.value = profile.id;
          model.select.appendChild(option);
        }
        if (
          target.aiProfileId &&
          !Array.from(model.select.options).some(
            (option) =>
              (option as HTMLOptionElement).value === target.aiProfileId,
          )
        ) {
          const missing = element(doc, "option", tr("missing-model"));
          missing.value = target.aiProfileId;
          model.select.appendChild(missing);
        }
        model.select.value = target.aiProfileId;
        model.label.hidden = target.provider !== "ai";
      };
      refreshModels.push(refresh);
      refresh();
      service.select.addEventListener("change", () => {
        target.provider = service.select.value as TranslationTarget["provider"];
        target.aiProfileId = "";
        refresh();
        change(read());
      });
      model.select.addEventListener("change", () => {
        target.aiProfileId = model.select.value;
        change(read());
      });
      const remove = element(doc, "button", tr("target-remove"));
      remove.type = "button";
      remove.dataset.action = "target-remove";
      remove.addEventListener("click", () => {
        change(read().filter((_, i) => i !== index));
        render();
      });
      const actions = element(doc, "div");
      actions.className = "zwl-selection-target-actions";
      for (const [name, delta] of [
        ["target-up", -1],
        ["target-down", 1],
      ] as const) {
        const button = element(doc, "button", tr(name));
        button.type = "button";
        button.dataset.action = name;
        button.disabled = index + delta < 0 || index + delta >= read().length;
        button.addEventListener("click", () => {
          const targets = [...read()];
          [targets[index], targets[index + delta]] = [
            targets[index + delta],
            targets[index],
          ];
          change(targets);
          render();
        });
        actions.appendChild(button);
      }
      actions.appendChild(remove);
      row.append(service.label, model.label, actions);
      root.appendChild(row);
    });
    const add = element(doc, "button", tr("target-add"));
    add.type = "button";
    add.dataset.action = "target-add";
    add.addEventListener("click", () => {
      change([...read(), { provider: "google", aiProfileId: "" }]);
      render();
    });
    root.appendChild(add);
  };
  render();
  return { root, refresh: () => refreshModels.forEach((refresh) => refresh()) };
}

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
  choice("sourceLang", ["auto", ...LANGUAGES], (id) => tr(`lang-${id}`));
  choice("targetLang", LANGUAGES, (id) => tr(`lang-${id}`));
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
  const rulesDraft: LengthRule[] = getLengthRules(settings).map((rule) => ({
    ...rule,
    targets: rule.targets.map((target) => ({
      ...target,
      aiProfileId:
        target.provider === "ai" ? target.aiProfileId || getActiveId() : "",
    })),
  }));
  const showProvider = () => {
    const providers = new Set([
      ...rulesDraft.flatMap((rule) =>
        rule.targets.map((target) => target.provider),
      ),
    ]);
    for (const node of grid.querySelectorAll<HTMLElement>("[data-provider]"))
      node.hidden = !providers.has(node.dataset.provider!);
  };
  showProvider();
  const historyLabel = element(doc, "label", tr("historyLimit"));
  const historyLimit = element(doc, "input");
  historyLimit.type = "number";
  historyLimit.min = "0";
  historyLimit.max = "1000";
  historyLimit.step = "1";
  historyLimit.dataset.pref = "historyLimit";
  historyLimit.value = String(settings.historyLimit);
  historyLimit.addEventListener("change", () => {
    if (!historyLimit.value || !historyLimit.checkValidity()) {
      historyLimit.reportValidity();
      return;
    }
    saved("historyLimit", Number(historyLimit.value));
    void translationHistory.trim().catch(() => {
      status.textContent = tr("error-history-write");
    });
  });
  historyLabel.append(
    historyLimit,
    element(doc, "span", tr("history-limit-hint")),
  );
  const historySection = element(doc, "section");
  historySection.className = "zwl-selection-history-settings";
  const historyGrid = element(doc, "div");
  historyGrid.className = "zwl-selection-settings-grid";
  const cacheLabel = element(doc, "label", tr("historyMaxMB"));
  const cacheLimit = element(doc, "input");
  cacheLimit.type = "number";
  cacheLimit.min = "0";
  cacheLimit.max = "10240";
  cacheLimit.step = "1";
  cacheLimit.value = String(settings.historyMaxMB);
  cacheLimit.dataset.pref = "historyMaxMB";
  cacheLimit.addEventListener("change", () => {
    if (!cacheLimit.value || !cacheLimit.checkValidity()) {
      cacheLimit.reportValidity();
      return;
    }
    saved("historyMaxMB", Number(cacheLimit.value));
    void translationHistory.trim().catch(() => {
      status.textContent = tr("error-history-write");
    });
  });
  cacheLabel.append(cacheLimit, element(doc, "span", tr("history-size-hint")));
  historyGrid.append(historyLabel, cacheLabel);
  historySection.append(element(doc, "h3", tr("history-title")), historyGrid);
  const section = (title: string) => {
    const node = element(doc, "section");
    node.className = "zwl-selection-setting-section";
    node.append(element(doc, "h3", tr(title)));
    return node;
  };
  const rules = section("rules-title");
  const rulesList = element(doc, "div");
  rulesList.className = "zwl-selection-rules";
  let rulePickers: ReturnType<typeof targetPicker>[] = [];
  const saveRules = () => {
    if (
      !rulesDraft.every(validRule) ||
      Array.from(
        rulesList.querySelectorAll<HTMLInputElement>('input[type="number"]'),
      ).some((input) => !(input as HTMLInputElement).checkValidity())
    ) {
      status.textContent = tr("error-rule");
      status.dataset.error = "true";
      return false;
    }
    const models = new Set(
      listModelProfiles()
        .filter((profile) => profile.model)
        .map((profile) => profile.id),
    );
    if (
      rulesDraft.some((rule) =>
        rule.targets.some(
          (target) =>
            target.provider === "ai" && !models.has(target.aiProfileId),
        ),
      )
    ) {
      status.textContent = tr("error-model-selection");
      status.dataset.error = "true";
      return false;
    }
    saved(
      "lengthRules",
      rulesDraft.map((rule) => ({
        ...rule,
        targets: normalizeTargets(rule.targets),
      })),
    );
    saved("rulesConfigured", true);
    status.dataset.error = "false";
    showProvider();
    return true;
  };
  const action = (name: string, fn: () => void) => {
    const button = element(doc, "button", tr(name));
    button.type = "button";
    button.dataset.action = name;
    button.addEventListener("click", fn);
    return button;
  };
  const renderRules = () => {
    rulesList.replaceChildren();
    rulePickers = [];
    if (!rulesDraft.length)
      rulesList.appendChild(element(doc, "p", tr("rules-empty")));
    rulesDraft.forEach((rule, index) => {
      const card = element(doc, "section");
      card.className = "zwl-selection-rule";
      card.dataset.ruleId = rule.id;
      const header = element(doc, "div");
      header.className = "zwl-selection-rule-header";
      const up = action("rule-up", () => {
        [rulesDraft[index - 1], rulesDraft[index]] = [
          rule,
          rulesDraft[index - 1],
        ];
        renderRules();
      });
      const down = action("rule-down", () => {
        [rulesDraft[index + 1], rulesDraft[index]] = [
          rule,
          rulesDraft[index + 1],
        ];
        renderRules();
      });
      up.disabled = index === 0;
      down.disabled = index === rulesDraft.length - 1;
      header.append(
        element(
          doc,
          "h4",
          tr("rule-number", { number: String(index + 1).padStart(2, "0") }),
        ),
        up,
        down,
        action("rule-remove", () => {
          rulesDraft.splice(index, 1);
          renderRules();
        }),
      );
      const fields = element(doc, "div");
      fields.className = "zwl-selection-rule-fields";
      const unit = selectControl(
        doc,
        tr("rule-unit"),
        ["words", "characters"],
        (id) => tr(`unit-${id}`),
      );
      unit.select.value = rule.unit;
      unit.select.dataset.field = "unit";
      unit.select.addEventListener("change", () => {
        rule.unit = unit.select.value as LengthRule["unit"];
      });
      fields.appendChild(unit.label);
      for (const key of ["min", "max"] as const) {
        const field = element(doc, "label", tr(`rule-${key}`));
        const input = element(doc, "input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.dataset.field = key;
        input.value = rule[key] === null ? "" : String(rule[key]);
        input.placeholder = key === "max" ? tr("unlimited") : "0";
        input.addEventListener("input", () => {
          const value = input.value === "" ? NaN : Number(input.value);
          if (key === "min") rule.min = value;
          else rule.max = input.value === "" ? null : value;
        });
        field.appendChild(input);
        fields.appendChild(field);
      }
      const picker = targetPicker(
        doc,
        () => rule.targets,
        (targets) => {
          rule.targets = targets;
          showProvider();
        },
      );
      rulePickers.push(picker);
      card.append(header, fields, picker.root);
      rulesList.appendChild(card);
    });
  };
  const makeRuleActions = () => {
    const ruleActions = element(doc, "div");
    ruleActions.className = "zwl-selection-rule-header";
    ruleActions.append(
      action("rule-add", () => {
        rulesDraft.push({
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          unit: "words",
          min: rulesDraft.at(-1)?.max ?? 0,
          max: null,
          targets: [],
        });
        renderRules();
      }),
      action("rules-save", () => {
        saveRules();
      }),
    );
    return ruleActions;
  };
  renderRules();
  rules.append(makeRuleActions(), rulesList, makeRuleActions());
  const general = element(doc, "section");
  general.className = "zwl-selection-general";
  general.append(element(doc, "h3", tr("general-options")), grid);
  root.append(general, historySection, rules, status);
  host.appendChild(root);
  const win = doc.defaultView;
  const refreshModelChoices = () => {
    rulePickers.forEach((picker) => picker.refresh());
  };
  win?.addEventListener("focus", refreshModelChoices);
  const unsubscribeProfiles = subscribeProfiles(refreshModelChoices);
  const historyObservers = ["historyLimit", "historyMaxMB"].map((key) =>
    Zotero.Prefs.registerObserver(
      PREF_PREFIX + key,
      () => {
        historyLimit.value = String(getSettings().historyLimit);
        cacheLimit.value = String(getSettings().historyMaxMB);
      },
      true,
    ),
  );
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeProfiles();
    historyObservers.forEach((observer) =>
      Zotero.Prefs.unregisterObserver(observer),
    );
    win?.removeEventListener("focus", refreshModelChoices);
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
