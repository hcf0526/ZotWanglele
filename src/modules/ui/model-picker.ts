import { config } from "../../../package.json";

export interface ModelPickerInput {
  fetchedModels: string[];
  currentModels: string[];
}

export interface ModelPickerResult {
  confirmed: boolean;
  selectedModels: string[];
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

export function splitModelGroups(input: ModelPickerInput): {
  available: string[];
  existing: string[];
} {
  const currentModels = uniqueModels(input.currentModels);
  const fetchedModels = uniqueModels(input.fetchedModels);
  const currentSet = new Set(currentModels);
  return {
    existing: currentModels,
    available: fetchedModels.filter((model) => !currentSet.has(model)),
  };
}

export function openModelPicker(
  parentWin: Window,
  input: ModelPickerInput,
): string[] | null {
  const result: ModelPickerResult = {
    confirmed: false,
    selectedModels: uniqueModels(input.currentModels),
  };
  const url = `chrome://${config.addonRef}/content/profile-editor.xhtml`;
  try {
    (parentWin as any).openDialog(
      url,
      "zotwanglele-model-picker",
      "chrome,centerscreen,modal,resizable=yes",
      { modelPicker: input },
      result,
    );
  } catch (error) {
    ztoolkit.log("[ModelPicker] open failed:", error);
    return null;
  }
  return result.confirmed ? result.selectedModels : null;
}

export function onModelPickerLoad(win: Window): void {
  const args = (win as any).arguments;
  const input: ModelPickerInput = args?.[0] ?? {
    fetchedModels: [],
    currentModels: [],
  };
  const result: ModelPickerResult = args?.[1] ?? {
    confirmed: false,
    selectedModels: [],
  };
  const doc = win.document;
  const editorShell = doc.querySelector(
    ".zwl-profile-editor-shell",
  ) as HTMLElement | null;
  const pickerShell = doc.getElementById(
    "zwl-model-picker-shell-root",
  ) as HTMLElement | null;
  if (editorShell) editorShell.hidden = true;
  if (pickerShell) pickerShell.hidden = false;
  const groups = splitModelGroups(input);
  const availableRoot = doc.getElementById(
    "zwl-model-picker-available",
  ) as HTMLElement | null;
  const existingRoot = doc.getElementById(
    "zwl-model-picker-existing",
  ) as HTMLElement | null;
  const availableEmpty = doc.getElementById(
    "zwl-model-picker-available-empty",
  ) as HTMLElement | null;
  const existingEmpty = doc.getElementById(
    "zwl-model-picker-existing-empty",
  ) as HTMLElement | null;
  const checkboxes: Array<{ model: string; input: HTMLInputElement }> = [];

  const create = <K extends keyof HTMLElementTagNameMap>(tag: K) =>
    doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElementTagNameMap[K];

  const addModel = (
    root: HTMLElement | null,
    model: string,
    checked: boolean,
  ) => {
    if (!root) return;
    const option = create("label");
    option.className = "zwl-model-picker-option";
    const checkbox = create("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.value = model;
    checkbox.dataset.model = model;
    const text = create("span");
    text.textContent = model;
    text.title = model;
    option.append(checkbox, text);
    root.append(option);
    checkboxes.push({ model, input: checkbox });
  };

  groups.available.forEach((model) => addModel(availableRoot, model, false));
  groups.existing.forEach((model) => addModel(existingRoot, model, true));
  if (availableEmpty) availableEmpty.hidden = groups.available.length > 0;
  if (existingEmpty) existingEmpty.hidden = groups.existing.length > 0;

  (win as any).zwlModelPickerApply = () => {
    result.confirmed = true;
    const selected = new Set(
      checkboxes.filter((item) => item.input.checked).map((item) => item.model),
    );
    result.selectedModels = [...groups.existing, ...groups.available].filter(
      (model) => selected.has(model),
    );
    win.close();
  };
  (win as any).zwlModelPickerCancel = () => {
    result.confirmed = false;
    win.close();
  };
}
