import { getSettings, LANGUAGES, PREF_PREFIX, setSetting } from "./config";
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
  const language = selectControl(doc, tr("target"), LANGUAGES, (id) =>
    tr(`lang-${id}`),
  );
  controls.append(language.label);
  const original = element(doc, "details");
  original.className = "zwl-selection-original";
  original.open = !popup;
  const originalText = element(doc, "div");
  originalText.className = "zwl-selection-text zwl-selection-source";
  original.append(element(doc, "summary", tr("original")), originalText);
  const results = element(doc, "div");
  results.className = "zwl-selection-results";
  results.setAttribute("aria-label", tr("translation"));
  const plan = element(doc, "p");
  plan.className = "zwl-selection-status";
  const cards = new Map<
    string,
    {
      card: HTMLElement;
      title: HTMLElement;
      status: HTMLElement;
      text: HTMLElement;
      copy: HTMLButtonElement;
    }
  >();
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
  const translate = button("translate", () => void session.run());
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
  const change = () => session.setOptions("configured", language.select.value);
  language.select.addEventListener("change", change);
  root.append(
    heading,
    controls,
    empty,
    original,
    plan,
    results,
    status,
    actions,
  );
  host.appendChild(root);
  const unmountHistory = popup ? () => {} : mountHistoryView(root, session);
  const unsubscribe = session.subscribe((state) => {
    language.select.value = state.targetLang;
    originalText.textContent = state.sourceText;
    plan.textContent = state.planLabel;
    plan.hidden = !state.planLabel;
    for (const [id, parts] of cards)
      if (!state.results.some((result) => result.id === id)) {
        parts.card.remove();
        cards.delete(id);
      }
    for (const result of state.results) {
      let parts = cards.get(result.id);
      if (!parts) {
        const card = element(doc, "section");
        card.className = "zwl-selection-comparison";
        const title = element(doc, "h4");
        const resultStatus = element(doc, "p");
        resultStatus.className = "zwl-selection-status";
        const text = element(doc, "div");
        text.className = "zwl-selection-text zwl-selection-result";
        const copy = element(doc, "button", tr("copy"));
        copy.type = "button";
        copy.addEventListener("click", () => {
          try {
            new ztoolkit.Clipboard()
              .addText(text.textContent || "", "text/unicode")
              .copy();
            status.textContent = tr("copied");
          } catch {
            status.textContent = tr("error-copy");
          }
        });
        card.append(title, resultStatus, text, copy);
        parts = { card, title, status: resultStatus, text, copy };
        cards.set(result.id, parts);
      }
      parts.title.textContent = result.label;
      parts.status.textContent =
        result.error ||
        tr(result.fromCache ? "cached" : `status-${result.status}`);
      parts.status.dataset.error = String(result.status === "error");
      parts.text.textContent = result.text;
      parts.copy.disabled = !result.text || result.status === "running";
      parts.card.dataset.state = result.status;
      results.appendChild(parts.card);
    }
    results.hidden = !state.results.length;
    original.hidden = !state.sourceText;
    empty.hidden = !!state.sourceText;
    const running = state.status === "running";
    translate.disabled = running || !state.sourceText.trim();
    translate.textContent = tr(
      ["partial", "error", "cancelled"].includes(state.status)
        ? "retry"
        : "translate",
    );
    stop.hidden = !running;
    copyResult.disabled = copyBoth.disabled = !state.text || running;
    status.dataset.error = String(state.status === "error");
    status.textContent =
      state.error || tr(state.fromCache ? "cached" : `status-${state.status}`);
    results.setAttribute("aria-busy", String(running));
  });
  return () => {
    unsubscribe();
    unmountHistory();
    root.remove();
  };
}

function mountHistoryView(
  host: HTMLElement,
  session: TranslationSession,
): () => void {
  const doc = host.ownerDocument!;
  const history = session.history;
  const root = element(doc, "details");
  root.className = "zwl-selection-history";
  root.open = true;
  const summary = element(doc, "summary", tr("history-title"));
  const limitLabel = element(doc, "label", tr("historyLimit"));
  const limit = element(doc, "input");
  limit.type = "number";
  limit.min = "0";
  limit.max = "1000";
  limit.step = "1";
  limit.dataset.pref = "historyLimit";
  limit.setAttribute("aria-label", tr("historyLimit"));
  limitLabel.appendChild(limit);
  const search = element(doc, "input");
  search.type = "search";
  search.placeholder = tr("history-search");
  search.setAttribute("aria-label", tr("history-search"));
  const count = element(doc, "p");
  count.className = "zwl-selection-status";
  const list = element(doc, "div");
  list.className = "zwl-selection-history-list";
  const more = element(doc, "button", tr("history-more"));
  more.type = "button";
  const clear = element(doc, "button", tr("history-clear"));
  clear.type = "button";
  clear.dataset.action = "history-clear";
  const confirmation = element(doc, "div");
  confirmation.hidden = true;
  const confirm = element(doc, "button", tr("history-confirm"));
  const cancel = element(doc, "button", tr("history-cancel"));
  confirm.type = cancel.type = "button";
  confirmation.append(
    element(doc, "p", tr("history-confirm-hint")),
    confirm,
    cancel,
  );
  root.append(
    summary,
    limitLabel,
    element(doc, "p", tr("history-limit-hint")),
    search,
    count,
    list,
    more,
    clear,
    confirmation,
  );
  host.appendChild(root);
  let visible = 20;
  let disposed = false;
  const render = () => {
    if (disposed) return;
    limit.value = String(getSettings().historyLimit);
    const query = search.value.trim().toLocaleLowerCase();
    const entries = history.snapshot.filter((entry) =>
      [
        entry.sourceText,
        ...entry.results.flatMap((result) => [result.label, result.text]),
      ].some((text) => text.toLocaleLowerCase().includes(query)),
    );
    count.textContent = history.error
      ? tr(`error-${history.error}`)
      : tr("history-count", { count: entries.length });
    count.dataset.error = String(!!history.error);
    list.replaceChildren();
    if (!entries.length)
      list.appendChild(
        element(doc, "p", tr(query ? "history-no-matches" : "history-empty")),
      );
    for (const entry of entries.slice(0, visible)) {
      const item = element(doc, "div");
      item.className = "zwl-selection-history-item";
      const open = element(doc, "button", entry.sourceText);
      open.type = "button";
      open.className = "zwl-selection-history-open";
      open.title = entry.sourceText;
      open.dataset.action = "history-open";
      open.addEventListener("click", () => session.showHistory(entry));
      const meta = element(
        doc,
        "p",
        `${tr(`lang-${entry.targetLang}`)} · ${new Date(entry.updatedAt).toLocaleString()} · ${entry.results.map((result) => result.label).join("、")}`,
      );
      meta.className = "zwl-selection-status";
      const remove = element(doc, "button", tr("history-remove"));
      remove.type = "button";
      remove.dataset.action = "history-remove";
      remove.addEventListener(
        "click",
        () => void history.remove(entry.id).catch(render),
      );
      item.append(open, meta, remove);
      list.appendChild(item);
    }
    more.hidden = entries.length <= visible;
    clear.disabled = !history.snapshot.length;
  };
  limit.addEventListener("change", () => {
    if (!limit.value || !limit.checkValidity()) {
      limit.reportValidity();
      return;
    }
    setSetting("historyLimit", Number(limit.value));
    void history.trim().catch(render);
  });
  search.addEventListener("input", () => {
    visible = 20;
    render();
  });
  more.addEventListener("click", () => {
    visible += 20;
    render();
  });
  clear.addEventListener("click", () => {
    confirmation.hidden = false;
    confirm.focus();
  });
  cancel.addEventListener("click", () => {
    confirmation.hidden = true;
    clear.focus();
  });
  confirm.addEventListener("click", () => {
    confirmation.hidden = true;
    void history.clear().catch(render);
  });
  const unsubscribe = history.subscribe(render);
  const observer = Zotero.Prefs.registerObserver(
    PREF_PREFIX + "historyLimit",
    render,
    true,
  );
  render();
  void history.ready().then(render, render);
  return () => {
    disposed = true;
    unsubscribe();
    Zotero.Prefs.unregisterObserver(observer);
    root.remove();
  };
}
