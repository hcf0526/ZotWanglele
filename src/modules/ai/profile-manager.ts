import { config } from "../../../package.json";
import {
  ensureDefaultProfile,
  listProfiles,
  listModelProfiles,
  groupProfilesBySupplier,
  getActiveId,
  getProfile,
  getSupplierName,
  getModelLabel,
  setActiveId,
  saveSupplier,
  deleteSupplier,
  moveProfile,
  subscribeProfiles,
} from "./profiles";
import { openProfileEditor } from "./profile-editor";
import { openConfirmDialog } from "../ui/confirm-dialog";
import { AiClient } from "./ai-client";

const mounts = new Map<Element, () => void>();

export function unmountProfileManagers(): void {
  for (const cleanup of [...mounts.values()]) cleanup();
}

/** Both entry points render the same configuration and model controls. */
export function mountProfileManager(win: Window, host: Element): () => void {
  mounts.get(host)?.();
  ensureDefaultProfile();
  const doc = win.document;
  const zh = Zotero.locale?.startsWith("zh");
  const text = (chinese: string, english: string) => (zh ? chinese : english);
  const html = (tag: string, className: string, content = "") => {
    const node = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElement;
    node.className = className;
    node.textContent = content;
    return node;
  };
  const xul = (tag: string, attrs: Record<string, string> = {}) => {
    const node = doc.createXULElement(tag) as any;
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    return node;
  };
  const id = (suffix: string) =>
    `zotero-prefpane-${config.addonRef}-profile-${suffix}`;
  const root = html("section", "zwl-ai-manager");
  const heading = html("header", "zwl-ai-heading");
  heading.append(
    html("h3", "zwl-ai-title", text("AI 配置", "AI Configuration")),
    html(
      "p",
      "zwl-ai-hint",
      text(
        "管理多个 API Key 与模型，双击模型可编辑关联信息。",
        "Manage API keys and models. Double-click a model to edit its association.",
      ),
    ),
  );
  const current = html("div", "zwl-ai-current");
  const currentName = html("strong", "zwl-ai-current-model");
  const currentSupplier = html("span", "zwl-ai-current-supplier");
  current.append(
    html("span", "zwl-ai-current-label", text("当前模型", "Current model")),
    currentName,
    currentSupplier,
  );
  const list = xul("richlistbox", {
    id: id("list"),
    class: "zwl-ai-list",
    "aria-label": text("配置与模型", "Configurations and models"),
  });
  const actions = html("div", "zwl-ai-actions");
  const status = html("p", "zwl-ai-status");
  status.setAttribute("role", "status");
  root.append(heading, current, list, actions, status);
  host.appendChild(root);
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let testSerial = 0;
  let testInFlight = false;
  const on = (el: EventTarget, event: string, handler: EventListener) => {
    el.addEventListener(event, handler);
    cleanups.push(() => el.removeEventListener(event, handler));
  };
  const message = (value: string, error = false) => {
    status.textContent = value;
    status.dataset.error = String(error);
  };
  const selectedId = (): string | null => {
    const item = list.selectedItem;
    return item && !item.hasAttribute("data-header")
      ? item.getAttribute("value")
      : null;
  };
  const select = (value: string | null) => {
    const item = Array.from(list.children as HTMLCollection).find(
      (node) => node.getAttribute("value") === value,
    );
    if (item) list.selectedItem = item;
  };
  const buttons = new Map<string, any>();
  const button = (
    key: string,
    label: string,
    action: () => void,
    variant = "",
  ) => {
    const node = xul("button", {
      id: id(key),
      label,
      class: `zwl-ai-button ${variant}`,
    });
    on(node, "command", () => action());
    actions.appendChild(node);
    buttons.set(key, node);
    return node;
  };
  const updateActions = () => {
    const selected = getProfile(selectedId() || "");
    const active = getProfile(getActiveId());
    const same =
      selected?.model === active?.model &&
      selected &&
      active &&
      getSupplierName(selected) === getSupplierName(active);
    buttons.get("use").disabled = !selected?.model || !!same;
    buttons.get("test").disabled = !selected?.model || testInFlight;
    buttons.get("edit").disabled = !selected;
    buttons.get("delete").disabled =
      !selected || groupProfilesBySupplier(listProfiles()).size <= 1;
    const group = listModelProfiles().filter(
      (p) => selected && getSupplierName(p) === getSupplierName(selected),
    );
    const index = group.findIndex((p) => p.id === selected?.id);
    buttons.get("up").disabled = index <= 0;
    buttons.get("down").disabled = index < 0 || index >= group.length - 1;
  };
  const refresh = () => {
    const selected = selectedId();
    const scrollTop = list.scrollTop;
    const active = getProfile(getActiveId());
    list.replaceChildren();
    currentName.textContent = active?.model
      ? getModelLabel(active)
      : text("尚未配置模型", "Model not configured");
    currentSupplier.textContent = active ? getSupplierName(active) : "";
    for (const [supplier, profiles] of groupProfilesBySupplier(
      listModelProfiles(),
    )) {
      const header = xul("richlistitem", {
        disabled: "true",
        "data-header": "true",
        class: "zwl-ai-group",
      });
      header.appendChild(
        xul("label", {
          value: supplier || text("未命名配置", "Unnamed configuration"),
          crop: "end",
          flex: "1",
        }),
      );
      list.appendChild(header);
      for (const profile of profiles) {
        const isActive =
          !!active &&
          active.model === profile.model &&
          getSupplierName(active) === supplier;
        const item = xul("richlistitem", {
          value: profile.id,
          class: "zwl-ai-model",
          "data-active": String(isActive),
        });
        const name = profile.model
          ? getModelLabel(profile)
          : text("尚未添加模型", "No model added");
        item.appendChild(
          xul("label", {
            value: name,
            tooltiptext: name,
            crop: "end",
            flex: "1",
            class: "zwl-ai-model-name",
          }),
        );
        if (isActive)
          item.appendChild(
            xul("label", {
              value: text("使用中", "In use"),
              class: "zwl-ai-active-mark",
            }),
          );
        list.appendChild(item);
      }
    }
    select(selected);
    list.scrollTop = scrollTop;
    updateActions();
  };
  const edit = () => {
    const profile = getProfile(selectedId() || "");
    if (!profile) return;
    const draft = openProfileEditor(win, profile);
    if (!draft) return;
    const saved = saveSupplier(draft, getSupplierName(profile));
    select(saved.id);
    message(text("配置已保存", "Configuration saved"));
  };
  const testConnection = async () => {
    const selected = getProfile(selectedId() || "");
    if (!selected?.model || testInFlight) return;
    const serial = ++testSerial;
    testInFlight = true;
    updateActions();
    message(text("正在测试连接…", "Testing connection…"));
    try {
      const result = await new AiClient({
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        model: selected.model,
        format: selected.format,
        temperature: selected.temperature / 100,
        maxTokens: selected.maxTokens,
        maxRetries: 0,
      }).testConnection();
      if (disposed || serial !== testSerial) return;
      if (result.ok) {
        message(
          text(
            `连接成功，延迟 ${result.latencyMs} ms`,
            `Connection succeeded, ${result.latencyMs} ms`,
          ),
        );
      } else {
        message(
          text(
            `连接失败，延迟 ${result.latencyMs} ms，${result.message.slice(0, 120)}`,
            `Connection failed after ${result.latencyMs} ms, ${result.message.slice(0, 120)}`,
          ),
          true,
        );
      }
    } catch (error) {
      if (disposed || serial !== testSerial) return;
      const detail = error instanceof Error ? error.message : String(error);
      message(
        text(
          `连接失败，${detail.slice(0, 120)}`,
          `Connection failed, ${detail.slice(0, 120)}`,
        ),
        true,
      );
    } finally {
      if (serial === testSerial) {
        testInFlight = false;
        if (!disposed) updateActions();
      }
    }
  };
  button(
    "use",
    text("设为当前", "Set as current"),
    () => {
      const selected = getProfile(selectedId() || "");
      if (!selected?.model) return;
      setActiveId(selected.id);
      message(text("当前模型已更新", "Current model updated"));
    },
    "zwl-ai-button-primary",
  );
  button("test", text("测试连接", "Test connection"), () => {
    void testConnection();
  });
  button("add", text("添加", "Add"), () => {
    const draft = openProfileEditor(win, null);
    if (!draft) return;
    const saved = saveSupplier(draft);
    select(saved.id);
    message(text("配置已添加", "Configuration added"));
  });
  button("edit", text("编辑", "Edit"), edit);
  button(
    "delete",
    text("删除", "Delete"),
    () => {
      const selected = selectedId();
      if (!selected || groupProfilesBySupplier(listProfiles()).size <= 1)
        return;
      if (
        !openConfirmDialog(win, {
          title: text("删除配置", "Delete configuration"),
          message: text(
            "确定删除所选模型所属配置及其全部 Key 和模型？",
            "Delete this configuration and all of its API keys and models?",
          ),
          confirmLabel: text("删除", "Delete"),
        })
      )
        return;
      deleteSupplier(selected);
      message(text("配置已删除", "Configuration deleted"));
    },
    "zwl-ai-button-danger",
  );
  const order = html("span", "zwl-ai-order");
  for (const [key, label, direction] of [
    ["up", text("↑ 上移", "↑ Move up"), -1],
    ["down", text("↓ 下移", "↓ Move down"), 1],
  ] as const) {
    order.appendChild(
      button(key, label, () => {
        const selected = selectedId();
        if (selected && moveProfile(selected, direction)) select(selected);
      }),
    );
  }
  actions.appendChild(order);
  on(list, "select", () => {
    if (testInFlight) {
      testSerial++;
      testInFlight = false;
    }
    updateActions();
  });
  on(list, "dblclick", (event: Event) => {
    const item = (event.target as Element).closest("richlistitem");
    if (item && !item.hasAttribute("data-header")) edit();
  });
  refresh();
  cleanups.push(subscribeProfiles(refresh));
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cleanups.forEach((fn) => fn());
    root.remove();
    mounts.delete(host);
    win.removeEventListener("unload", cleanup);
  };
  win.addEventListener("unload", cleanup, { once: true });
  mounts.set(host, cleanup);
  return cleanup;
}
