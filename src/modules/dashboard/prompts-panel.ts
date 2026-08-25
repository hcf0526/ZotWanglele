import {
  PromptTemplate,
  addCustomTemplate,
  deleteCustomTemplate,
  getAllTemplates,
  resetBuiltinTemplate,
  updateBuiltinTemplate,
  updateCustomTemplate,
} from "../ai/prompts";

const HTML_NS = "http://www.w3.org/1999/xhtml";

export function mountPromptsPanel(win: Window): () => void {
  const doc = win.document;
  const strings = getStrings();
  const root = doc.getElementById("zotwanglele-dashboard-prompts-list");
  if (!root) return () => undefined;

  const list = doc.getElementById("zwl-prompt-list") as HTMLElement;
  const form = doc.getElementById("zwl-prompt-form") as HTMLFormElement;
  const newButton = doc.getElementById("zwl-prompt-new") as HTMLButtonElement;
  const deleteButton = doc.getElementById(
    "zwl-prompt-delete",
  ) as HTMLButtonElement;
  const resetButton = doc.getElementById(
    "zwl-prompt-reset",
  ) as HTMLButtonElement;
  if (!list || !form || !newButton || !deleteButton || !resetButton) {
    ztoolkit.log("[PromptsPanel] required elements are unavailable");
    return () => undefined;
  }
  let selectedId: string | null = getAllTemplates()[0]?.id ?? null;
  let creating = false;
  let creatingName = "";
  let creatingDescription = "";

  const getField = (id: string) =>
    doc.getElementById(id) as HTMLTextAreaElement;

  const showTemplate = (template?: PromptTemplate) => {
    const values = template ?? {
      name: "",
      description: "",
      systemPrompt: "",
      userPrompt: "",
      builtin: false,
    };
    const nameView = doc.getElementById("zwl-prompt-name-view") as HTMLElement;
    const descriptionView = doc.getElementById(
      "zwl-prompt-description-view",
    ) as HTMLElement;

    nameView.textContent = values.name;
    descriptionView.textContent = values.description || strings.noDescription;
    getField("zwl-prompt-system").value = values.systemPrompt;
    getField("zwl-prompt-user").value = values.userPrompt;
    getField("zwl-prompt-system").disabled = false;
    getField("zwl-prompt-user").disabled = false;
    deleteButton.hidden = !!values.builtin || creating;
    resetButton.hidden = !values.builtin || creating;
    (doc.getElementById("zwl-prompt-save") as HTMLButtonElement).hidden = false;
    setStatus(doc, "");
  };

  const renderList = () => {
    list.replaceChildren();
    for (const template of getAllTemplates()) {
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
      name.textContent = template.name;
      const meta = doc.createElementNS(HTML_NS, "span");
      meta.textContent = template.builtin ? strings.builtin : strings.custom;
      const description = doc.createElementNS(HTML_NS, "small");
      description.textContent = template.description || strings.noDescription;
      button.append(name, meta, description);
      button.addEventListener("click", () => {
        selectedId = template.id;
        creating = false;
        renderList();
        showTemplate(template);
      });
      list.append(button);
    }
  };

  const onNew = () => {
    const name = win.prompt(strings.newNamePrompt, "")?.trim() ?? "";
    if (!name) return;
    const description =
      win.prompt(strings.newDescriptionPrompt, "")?.trim() ?? "";
    creating = true;
    creatingName = name;
    creatingDescription = description;
    selectedId = null;
    renderList();
    showTemplate({
      id: "",
      name: creatingName,
      description: creatingDescription,
      systemPrompt: "",
      userPrompt: "",
      builtin: false,
    });
    getField("zwl-prompt-system").focus();
  };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const selectedTemplate = selectedId
      ? getAllTemplates().find((item) => item.id === selectedId)
      : undefined;
    const draft = {
      systemPrompt: getField("zwl-prompt-system").value.trim(),
      userPrompt: getField("zwl-prompt-user").value.trim(),
    };
    if (!draft.systemPrompt || !draft.userPrompt) {
      setStatus(doc, strings.requiredFields, true);
      return;
    }

    if (creating) {
      selectedId = `custom-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      addCustomTemplate({
        id: selectedId,
        name: creatingName,
        description: creatingDescription,
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
        updateCustomTemplate(selectedId, draft);
      }
    }
    renderList();
    showTemplate(getAllTemplates().find((item) => item.id === selectedId));
    setStatus(doc, strings.saved);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  const onReset = () => {
    if (!selectedId) return;
    const template = getAllTemplates().find((item) => item.id === selectedId);
    if (!template?.builtin || !win.confirm(strings.confirmReset(template.name)))
      return;
    resetBuiltinTemplate(selectedId);
    renderList();
    showTemplate(getAllTemplates().find((item) => item.id === selectedId));
    setStatus(doc, strings.reset);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };
  const onDelete = () => {
    if (!selectedId) return;
    const template = getAllTemplates().find((item) => item.id === selectedId);
    if (!template || template.builtin) return;
    if (!win.confirm(`删除自定义模板“${template.name}”？`)) return;
    deleteCustomTemplate(selectedId);
    selectedId = getAllTemplates()[0]?.id ?? null;
    renderList();
    showTemplate(getAllTemplates().find((item) => item.id === selectedId));
    setStatus(doc, strings.deleted);
    win.dispatchEvent(new CustomEvent("zotwanglele-prompts-changed"));
  };

  newButton.addEventListener("click", onNew);
  form.addEventListener("submit", onSubmit);
  deleteButton.addEventListener("click", onDelete);
  resetButton.addEventListener("click", onReset);
  renderList();
  showTemplate(getAllTemplates().find((item) => item.id === selectedId));

  return () => {
    newButton.removeEventListener("click", onNew);
    form.removeEventListener("submit", onSubmit);
    deleteButton.removeEventListener("click", onDelete);
    resetButton.removeEventListener("click", onReset);
  };
}

function getStrings() {
  if (!Zotero.locale?.startsWith("zh")) {
    return {
      builtin: "Built-in",
      custom: "Custom",
      noDescription: "No description",
      requiredFields: "Both prompts are required",
      newNamePrompt: "Template name",
      newDescriptionPrompt: "Template description (optional)",
      saved: "Template saved",
      reset: "Restored built-in template",
      deleted: "Template deleted",
      confirmReset: (name: string) => `Restore built-in template “${name}”?`,
    };
  }
  return {
    builtin: "内置",
    custom: "自定义",
    noDescription: "暂无说明",
    requiredFields: "请填写两类提示词",
    newNamePrompt: "模板名称",
    newDescriptionPrompt: "模板说明（可选）",
    saved: "模板已保存",
    reset: "已恢复内置模板",
    deleted: "模板已删除",
    confirmReset: (name: string) => `恢复模板“${name}”的内置内容？`,
  };
}

function setStatus(doc: Document, text: string, error = false): void {
  const status = doc.getElementById("zwl-prompt-status") as HTMLElement | null;
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-error", error);
}
