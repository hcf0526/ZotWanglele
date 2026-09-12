import {
  PromptFeature,
  PromptTemplate,
  UNGROUPED_FEATURE_ID,
  addCustomTemplate,
  deleteCustomTemplate,
  getActiveTemplateId,
  getPromptFeatures,
  getTemplatesForFeature,
  resetBuiltinTemplate,
  setActiveTemplate,
  updateBuiltinTemplate,
  updateCustomTemplate,
} from "../ai/prompts";
import { openConfirmDialog } from "../ui/confirm-dialog";

const HTML_NS = "http://www.w3.org/1999/xhtml";

export function mountPromptsPanel(win: Window): () => void {
  const doc = win.document;
  const strings = getStrings();
  const root = doc.getElementById("zotwanglele-dashboard-prompts-list");
  if (!root) return () => undefined;

  const featuresList = doc.getElementById("zwl-prompt-features") as HTMLElement;
  const list = doc.getElementById("zwl-prompt-list") as HTMLElement;
  const form = doc.getElementById("zwl-prompt-form") as HTMLFormElement;
  const newButton = doc.getElementById("zwl-prompt-new") as HTMLButtonElement;
  const deleteButton = doc.getElementById(
    "zwl-prompt-delete",
  ) as HTMLButtonElement;
  const resetButton = doc.getElementById(
    "zwl-prompt-reset",
  ) as HTMLButtonElement;
  const resetTopButton = doc.getElementById(
    "zwl-prompt-reset-top",
  ) as HTMLButtonElement;
  const useButton = doc.getElementById("zwl-prompt-use") as HTMLButtonElement;
  const nameInput = doc.getElementById("zwl-prompt-name") as HTMLInputElement;
  const descriptionInput = doc.getElementById(
    "zwl-prompt-description",
  ) as HTMLInputElement;
  if (
    !featuresList ||
    !list ||
    !form ||
    !newButton ||
    !deleteButton ||
    !resetButton ||
    !resetTopButton ||
    !useButton ||
    !nameInput ||
    !descriptionInput
  ) {
    ztoolkit.log("[PromptsPanel] required elements are unavailable");
    return () => undefined;
  }

  const features = () => getPromptFeatures();
  let selectedFeatureId: string = features()[0]?.id ?? "";
  let selectedId: string | null =
    getTemplatesForFeature(selectedFeatureId).find(
      (item) => item.id === getActiveTemplateId(selectedFeatureId),
    )?.id ??
    getTemplatesForFeature(selectedFeatureId)[0]?.id ??
    null;
  let creating = false;
  let creatingName = "";
  let creatingDescription = "";

  const getField = (id: string) =>
    doc.getElementById(id) as HTMLTextAreaElement;

  const currentTemplate = (): PromptTemplate | undefined => {
    if (!selectedId) return undefined;
    return getTemplatesForFeature(selectedFeatureId).find(
      (item) => item.id === selectedId,
    );
  };

  const showTemplate = (template?: PromptTemplate) => {
    const values = template ?? {
      name: "",
      description: "",
      systemPrompt: "",
      userPrompt: "",
      builtin: false,
      featureId: selectedFeatureId,
    };
    const nameView = doc.getElementById("zwl-prompt-name-view") as HTMLElement;
    const descriptionView = doc.getElementById(
      "zwl-prompt-description-view",
    ) as HTMLElement;
    const editingMeta = creating || !values.builtin;

    nameView.hidden = editingMeta;
    descriptionView.hidden = editingMeta;
    nameInput.hidden = !editingMeta;
    descriptionInput.hidden = !editingMeta;
    nameView.classList.toggle("zwl-is-hidden", editingMeta);
    descriptionView.classList.toggle("zwl-is-hidden", editingMeta);
    nameInput.classList.toggle("zwl-is-hidden", !editingMeta);
    descriptionInput.classList.toggle("zwl-is-hidden", !editingMeta);
    nameView.textContent = values.name;
    descriptionView.textContent = values.description || strings.noDescription;
    nameInput.value = values.name;
    descriptionInput.value = values.description;
    nameInput.placeholder = strings.newNamePrompt;
    descriptionInput.placeholder = strings.newDescriptionPrompt;
    getField("zwl-prompt-system").value = values.systemPrompt;
    getField("zwl-prompt-user").value = values.userPrompt;
    getField("zwl-prompt-system").disabled = false;
    getField("zwl-prompt-user").disabled = false;
    deleteButton.hidden = !!values.builtin || creating;
    resetButton.hidden = !values.builtin || creating;
    resetTopButton.hidden = !values.builtin || creating;
    const canUse =
      !creating &&
      !!template?.id &&
      selectedFeatureId !== UNGROUPED_FEATURE_ID &&
      getActiveTemplateId(selectedFeatureId) !== template.id;
    useButton.hidden = !canUse;
    (doc.getElementById("zwl-prompt-save") as HTMLButtonElement).hidden = false;
    setStatus(doc, "");
  };

  const renderFeatures = () => {
    featuresList.replaceChildren();
    for (const feature of features()) {
      const button = doc.createElementNS(
        HTML_NS,
        "button",
      ) as HTMLButtonElement;
      button.type = "button";
      button.className = "zwl-prompt-row";
      if (feature.id === selectedFeatureId) {
        button.classList.add("is-selected");
      }

      const name = doc.createElementNS(HTML_NS, "strong");
      name.textContent = featureLabel(feature, strings);
      const meta = doc.createElementNS(HTML_NS, "span");
      const count = getTemplatesForFeature(feature.id).length;
      meta.textContent = strings.templateCount(count);
      const description = doc.createElementNS(HTML_NS, "small");
      description.textContent =
        feature.id === UNGROUPED_FEATURE_ID
          ? strings.ungroupedDescription
          : feature.description;
      button.append(name, meta, description);
      button.addEventListener("click", () => {
        selectedFeatureId = feature.id;
        creating = false;
        const activeId = getActiveTemplateId(feature.id);
        selectedId =
          getTemplatesForFeature(feature.id).find(
            (item) => item.id === activeId,
          )?.id ??
          getTemplatesForFeature(feature.id)[0]?.id ??
          null;
        renderFeatures();
        renderList();
        showTemplate(currentTemplate());
      });
      featuresList.append(button);
    }
    newButton.disabled = selectedFeatureId === UNGROUPED_FEATURE_ID;
  };

  const renderList = () => {
    list.replaceChildren();
    const templates = getTemplatesForFeature(selectedFeatureId);
    const activeId = getActiveTemplateId(selectedFeatureId);
    for (const template of templates) {
      const button = doc.createElementNS(
        HTML_NS,
        "button",
      ) as HTMLButtonElement;
      button.type = "button";
      button.className = "zwl-prompt-row";
      if (!creating && template.id === selectedId) {
        button.classList.add("is-selected");
      }

      const name = doc.createElementNS(HTML_NS, "strong");
      name.textContent = template.builtin
        ? strings.defaultTemplate
        : template.name;
      const meta = doc.createElementNS(HTML_NS, "span");
      meta.textContent =
        template.id === activeId
          ? strings.using
          : template.builtin
            ? strings.builtin
            : strings.custom;
      if (template.id === activeId) {
        meta.classList.add("is-active");
      }
      const description = doc.createElementNS(HTML_NS, "small");
      description.textContent = template.description || strings.noDescription;
      button.append(name, meta, description);
      button.addEventListener("click", () => {
        selectedId = template.id;
        creating = false;
        renderFeatures();
        renderList();
        showTemplate(template);
      });
      list.append(button);
    }
    if (creating) {
      const button = doc.createElementNS(
        HTML_NS,
        "button",
      ) as HTMLButtonElement;
      button.type = "button";
      button.className = "zwl-prompt-row is-selected is-draft";
      const name = doc.createElementNS(HTML_NS, "strong");
      name.textContent = creatingName || strings.newDraft;
      const meta = doc.createElementNS(HTML_NS, "span");
      meta.textContent = strings.custom;
      const description = doc.createElementNS(HTML_NS, "small");
      description.textContent = creatingDescription || strings.noDescription;
      button.append(name, meta, description);
      list.append(button);
    }
  };

  const onNew = () => {
    if (!selectedFeatureId || selectedFeatureId === UNGROUPED_FEATURE_ID) {
      return;
    }
    const base =
      currentTemplate() ?? getTemplatesForFeature(selectedFeatureId)[0];
    creating = true;
    creatingName = "";
    creatingDescription = "";
    selectedId = null;
    renderFeatures();
    renderList();
    showTemplate({
      id: "",
      name: "",
      description: "",
      systemPrompt: base?.systemPrompt ?? "",
      userPrompt: base?.userPrompt ?? "",
      builtin: false,
      featureId: selectedFeatureId,
    });
    nameInput.focus();
  };

  const onMetaInput = () => {
    if (!creating) return;
    creatingName = nameInput.value.trim();
    creatingDescription = descriptionInput.value.trim();
    const draft = list.querySelector(
      ".zwl-prompt-row.is-draft",
    ) as HTMLElement | null;
    if (!draft) return;
    const name = draft.querySelector("strong");
    const description = draft.querySelector("small");
    if (name) name.textContent = creatingName || strings.newDraft;
    if (description) {
      description.textContent = creatingDescription || strings.noDescription;
    }
  };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const selectedTemplate = currentTemplate();
    const draft = {
      systemPrompt: getField("zwl-prompt-system").value.trim(),
      userPrompt: getField("zwl-prompt-user").value.trim(),
    };
    if (!draft.systemPrompt || !draft.userPrompt) {
      setStatus(doc, strings.requiredFields, true);
      return;
    }

    if (creating) {
      const name = nameInput.value.trim();
      if (!name) {
        setStatus(doc, strings.requiredName, true);
        nameInput.focus();
        return;
      }
      selectedId = `custom-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      addCustomTemplate({
        id: selectedId,
        name,
        description: descriptionInput.value.trim(),
        featureId: selectedFeatureId,
        ...draft,
      });
      creating = false;
      creatingName = "";
      creatingDescription = "";
    } else if (selectedId) {
      if (selectedTemplate?.builtin) {
        updateBuiltinTemplate(selectedId, {
          systemPrompt: draft.systemPrompt,
          userPrompt: draft.userPrompt,
        });
      } else {
        updateCustomTemplate(selectedId, {
          ...draft,
          name: nameInput.value.trim() || selectedTemplate?.name || "",
          description: descriptionInput.value.trim(),
        });
      }
    }
    renderFeatures();
    renderList();
    showTemplate(currentTemplate());
    setStatus(doc, strings.saved);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  const onReset = () => {
    if (!selectedId) return;
    const template = currentTemplate();
    if (
      !template?.builtin ||
      !openConfirmDialog(win, {
        title: strings.resetDialogTitle,
        message: strings.confirmReset(template.name),
        confirmLabel: strings.resetDialogAction,
      })
    )
      return;
    resetBuiltinTemplate(selectedId);
    renderFeatures();
    renderList();
    showTemplate(currentTemplate());
    setStatus(doc, strings.reset);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  const onUse = () => {
    if (!selectedId || selectedFeatureId === UNGROUPED_FEATURE_ID) return;
    if (!setActiveTemplate(selectedFeatureId, selectedId)) return;
    renderFeatures();
    renderList();
    showTemplate(currentTemplate());
    setStatus(doc, strings.activated);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  const onDelete = () => {
    if (!selectedId) return;
    const template = currentTemplate();
    if (!template || template.builtin) return;
    if (
      !openConfirmDialog(win, {
        title: strings.deleteDialogTitle,
        message: strings.confirmDelete(template.name),
        confirmLabel: strings.deleteDialogAction,
      })
    )
      return;
    deleteCustomTemplate(selectedId);
    const remaining = getTemplatesForFeature(selectedFeatureId);
    if (!remaining.length) {
      selectedFeatureId = features()[0]?.id ?? "";
    }
    selectedId =
      getTemplatesForFeature(selectedFeatureId).find(
        (item) => item.id === getActiveTemplateId(selectedFeatureId),
      )?.id ??
      getTemplatesForFeature(selectedFeatureId)[0]?.id ??
      null;
    renderFeatures();
    renderList();
    showTemplate(currentTemplate());
    setStatus(doc, strings.deleted);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  newButton.addEventListener("click", onNew);
  nameInput.addEventListener("input", onMetaInput);
  descriptionInput.addEventListener("input", onMetaInput);
  form.addEventListener("submit", onSubmit);
  deleteButton.addEventListener("click", onDelete);
  resetButton.addEventListener("click", onReset);
  resetTopButton.addEventListener("click", onReset);
  useButton.addEventListener("click", onUse);
  renderFeatures();
  renderList();
  showTemplate(currentTemplate());

  return () => {
    newButton.removeEventListener("click", onNew);
    nameInput.removeEventListener("input", onMetaInput);
    descriptionInput.removeEventListener("input", onMetaInput);
    form.removeEventListener("submit", onSubmit);
    deleteButton.removeEventListener("click", onDelete);
    resetButton.removeEventListener("click", onReset);
    resetTopButton.removeEventListener("click", onReset);
    useButton.removeEventListener("click", onUse);
  };
}

function featureLabel(
  feature: PromptFeature,
  strings: ReturnType<typeof getStrings>,
): string {
  return feature.id === UNGROUPED_FEATURE_ID ? strings.ungrouped : feature.name;
}

function getStrings() {
  if (!Zotero.locale?.startsWith("zh")) {
    return {
      builtin: "Built-in",
      custom: "Custom",
      using: "In use",
      defaultTemplate: "Default template",
      ungrouped: "Ungrouped",
      ungroupedDescription: "Templates not attached to a feature",
      templateCount: (count: number) =>
        count === 1 ? "1 template" : `${count} templates`,
      noDescription: "No description",
      requiredFields: "Both prompts are required",
      requiredName: "Please enter a template name",
      newDraft: "New template",
      newNamePrompt: "Template name",
      newDescriptionPrompt: "Template description (optional)",
      saved: "Template saved",
      reset: "Restored built-in template",
      deleted: "Template deleted",
      activated: "This template is now in use",
      resetDialogTitle: "Restore template",
      resetDialogAction: "Restore",
      confirmReset: (name: string) => `Restore built-in template “${name}”?`,
      deleteDialogTitle: "Delete template",
      deleteDialogAction: "Delete",
      confirmDelete: (name: string) => `Delete custom template “${name}”?`,
    };
  }
  return {
    builtin: "内置",
    custom: "自定义",
    using: "使用中",
    defaultTemplate: "默认模板",
    ungrouped: "未分组",
    ungroupedDescription: "尚未归入具体功能的模板",
    templateCount: (count: number) => `${count} 套模板`,
    noDescription: "暂无说明",
    requiredFields: "请填写两类提示词",
    requiredName: "请填写模板名称",
    newDraft: "新模板",
    newNamePrompt: "模板名称",
    newDescriptionPrompt: "模板说明（可选）",
    saved: "模板已保存",
    reset: "已恢复内置模板",
    deleted: "模板已删除",
    activated: "已设为当前使用的模板",
    resetDialogTitle: "恢复内置模板",
    resetDialogAction: "恢复",
    confirmReset: (name: string) => `恢复模板“${name}”的内置内容？`,
    deleteDialogTitle: "删除自定义模板",
    deleteDialogAction: "删除",
    confirmDelete: (name: string) => `删除自定义模板“${name}”？`,
  };
}

function setStatus(doc: Document, text: string, error = false): void {
  const status = doc.getElementById("zwl-prompt-status") as HTMLElement | null;
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-error", error);
}
