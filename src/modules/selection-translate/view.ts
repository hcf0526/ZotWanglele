import { LANGUAGES, PROVIDERS } from "./config";
import { TranslationSession } from "./session";
import { tr } from "./locale";
import { ensureSelectionStyles } from "./styles";

export function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text = "",
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    tag,
  ) as HTMLElementTagNameMap[K];
  if (text) node.textContent = text;
  return node;
}

export function selectControl(
  doc: Document,
  labelText: string,
  choices: readonly string[],
  label: (value: string) => string,
): { label: HTMLLabelElement; select: HTMLSelectElement } {
  const wrapper = element(doc, "label", labelText);
  const select = element(doc, "select");
  select.setAttribute("aria-label", labelText);
  for (const choice of choices) {
    const option = element(doc, "option", label(choice));
    option.value = choice;
    select.appendChild(option);
  }
  wrapper.appendChild(select);
  return { label: wrapper, select };
}

export function mountTranslationView(
  host: HTMLElement,
  session: TranslationSession,
  popup: boolean,
): () => void {
  const doc = host.ownerDocument!;
  ensureSelectionStyles(doc);
  const root = element(doc, "div");
  root.className = `zwl-selection ${popup ? "zwl-selection-popup" : "zwl-selection-sidebar"}`;
  const heading = element(doc, "h3", tr("title"));
  heading.className = "zwl-selection-heading";
  const controls = element(doc, "div");
  controls.className = "zwl-selection-controls";
  const service = selectControl(doc, tr("service"), PROVIDERS, (id) =>
    tr(`provider-${id}`),
  );
  const language = selectControl(doc, tr("target"), LANGUAGES, (id) =>
    tr(`lang-${id}`),
  );
  controls.append(service.label, language.label);
  const original = element(doc, "details");
  original.className = "zwl-selection-original";
  original.open = !popup;
  const originalText = element(doc, "div");
  originalText.className = "zwl-selection-text zwl-selection-source";
  original.append(element(doc, "summary", tr("original")), originalText);
  const result = element(doc, "div");
  result.className = "zwl-selection-text zwl-selection-result";
  result.setAttribute("aria-label", tr("translation"));
  const empty = element(doc, "p", tr("empty"));
  empty.className = "zwl-selection-empty";
  const status = element(doc, "p");
  status.className = "zwl-selection-status";
  status.setAttribute("role", "status");
  const actions = element(doc, "div");
  actions.className = "zwl-selection-actions";
  const button = (name: string, fn: () => void) => {
    const el = element(doc, "button", tr(name));
    el.type = "button";
    el.dataset.action = name;
    el.addEventListener("click", fn);
    actions.appendChild(el);
    return el;
  };
  const translate = button(
    "translate",
    () => void session.run(session.snapshot.status !== "ready"),
  );
  translate.className = "zwl-selection-primary";
  const stop = button("stop", () => session.stop());
  const copy = (bilingual: boolean) => {
    try {
      new ztoolkit.Clipboard()
        .addText(session.copyText(bilingual), "text/unicode")
        .copy();
      status.textContent = tr("copied");
    } catch {
      status.textContent = tr("error-copy");
    }
  };
  const copyResult = button("copy", () => copy(false));
  const copyBoth = button("copy-both", () => copy(true));
  const change = () =>
    session.setOptions(
      service.select.value as typeof session.snapshot.provider,
      language.select.value,
    );
  service.select.addEventListener("change", change);
  language.select.addEventListener("change", change);
  root.append(heading, controls, empty, original, result, status, actions);
  host.appendChild(root);
  const unsubscribe = session.subscribe((state) => {
    service.select.value = state.provider;
    language.select.value = state.targetLang;
    originalText.textContent = state.sourceText;
    result.textContent = state.text;
    result.hidden = !state.text;
    original.hidden = !state.sourceText;
    empty.hidden = !!state.sourceText;
    const running = state.status === "running";
    translate.disabled = running || !state.sourceText.trim();
    translate.textContent = tr(
      ["success", "error", "cancelled"].includes(state.status)
        ? "retry"
        : "translate",
    );
    stop.hidden = !running;
    copyResult.disabled = copyBoth.disabled = !state.text || running;
    status.dataset.error = String(state.status === "error");
    status.textContent =
      state.error || tr(state.fromCache ? "cached" : `status-${state.status}`);
    result.setAttribute("aria-busy", String(running));
  });
  return () => {
    unsubscribe();
    root.remove();
  };
}
