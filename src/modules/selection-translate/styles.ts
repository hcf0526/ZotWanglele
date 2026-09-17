const styleDocuments = new Map<Document, () => void>();

export function removeSelectionStyles(): void {
  for (const cleanup of [...styleDocuments.values()]) cleanup();
}

/** Scoped paper palette: the reader document has its own styles and origin. */
export function ensureSelectionStyles(doc: Document): void {
  if (doc.getElementById("zwl-selection-styles")) return;
  const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.id = "zwl-selection-styles";
  style.textContent = `
    .zwl-selection, .zwl-selection-settings {
      --zwl-paper: #fbf8f0; --zwl-paper-soft: #fffaf2; --zwl-rule: #d3c2a8;
      --zwl-ink: #2b241e; --zwl-ink-soft: #6c5d4f; --zwl-red: #b64b37;
      box-sizing: border-box; color: var(--zwl-ink); background: var(--zwl-paper);
      font: 13px/1.6 "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "思源宋体", "Songti SC", STSong, SimSun, serif;
      min-width: 0; min-height: 0; text-align: start;
    }
    .zwl-selection { padding: 12px; border: 1px solid var(--zwl-rule); border-radius: 8px; }
    .view-popup.selection-popup:has(.zwl-selection-popup-host) { width: 406px; max-width: calc(100% - 16px); max-height: calc(100% - 16px); overflow: auto; }
    .zwl-selection-popup-host { min-width: 0; }
    .zwl-selection-popup { width: 100%; margin-top: 8px; }
    .zwl-selection-sidebar { contain: inline-size; width: 100%; }
    .zwl-selection-heading { margin: 0 0 10px; padding-inline-start: 9px; border-inline-start: 3px solid var(--zwl-red); font-size: 15px; font-weight: 800; }
    .zwl-selection-controls, .zwl-selection-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
    .zwl-selection-controls > label { flex: 1 1 110px; min-width: 0; }
    .zwl-selection label, .zwl-selection-settings label { display: block; color: var(--zwl-ink-soft); font-size: 12px; }
    .zwl-selection select, .zwl-selection button, .zwl-selection input, .zwl-selection-settings button, .zwl-selection-settings select, .zwl-selection-settings input {
      box-sizing: border-box; appearance: none; -moz-appearance: none; font: inherit;
      border: 1px solid var(--zwl-rule); border-radius: 6px; color: var(--zwl-ink);
      background: #fffdf8; padding: 5px 8px; min-width: 0; max-width: 100%;
    }
    .zwl-selection select, .zwl-selection-settings select { width: 100%; padding-inline-end: 22px; background: #fffdf8 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Cpath d='m2 4 4 4 4-4' fill='none' stroke='%236c5d4f'/%3E%3C/svg%3E") no-repeat right 6px center; }
    .zwl-selection button, .zwl-selection-settings button { cursor: pointer; transition: background 150ms, border-color 150ms; }
    .zwl-selection button:hover, .zwl-selection-settings button:hover { border-color: var(--zwl-red); background: #f7e7df; }
    .zwl-selection button.zwl-selection-primary { color: #fffaf2; background: var(--zwl-red); border-color: var(--zwl-red); }
    .zwl-selection button.zwl-selection-primary:hover { background: #873627; }
    .zwl-selection button:disabled, .zwl-selection-settings button:disabled { color: #6f6255; background: #e9dfd0; border-color: var(--zwl-rule); cursor: default; }
    .zwl-selection :focus-visible, .zwl-selection-settings :focus-visible { outline: 2px solid #c87968; outline-offset: 2px; }
    .zwl-selection-original { margin: 10px 0; color: var(--zwl-ink-soft); }
    .zwl-selection-original summary { cursor: pointer; font-weight: 700; }
    .zwl-selection-text { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; max-height: 240px; overflow-y: auto; margin: 6px 0; user-select: text; }
    .zwl-selection-original .zwl-selection-text { max-height: 120px; }
    .zwl-selection-result { padding: 10px 0; border-block: 1px solid #e5d9c7; }
    .zwl-selection-status { margin: 8px 0; color: var(--zwl-ink-soft); font-size: 12px; overflow-wrap: anywhere; }
    .zwl-selection-status[data-error="true"] { color: #873627; }
    .zwl-selection-empty { padding: 12px; border: 1px dashed var(--zwl-rule); border-radius: 6px; color: var(--zwl-ink-soft); }
    .zwl-selection-settings { margin-top: 20px; padding: 16px; border: 1px solid var(--zwl-rule); border-radius: 8px; }
    .zwl-selection-settings h3 { margin: 0 0 5px; font-size: 17px; }
    .zwl-selection-settings p { margin: 4px 0 12px; color: var(--zwl-ink-soft); }
    .zwl-selection-settings-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px 16px; }
    .zwl-selection-settings input:not([type="checkbox"]) { display: block; width: 100%; }
    .zwl-selection-settings input[type="checkbox"] { appearance: auto; margin-inline-end: 7px; accent-color: var(--zwl-red); }
    .zwl-selection-setting-wide { grid-column: 1 / -1; }
    .zwl-selection-setting-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--zwl-rule); }
    .zwl-selection-targets { display: grid; gap: 10px; margin: 16px 0 0; min-height: 0; }
    .zwl-selection-target-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
    .zwl-selection-target-row > label { flex: 1 1 140px; min-width: 0; }
    .zwl-selection-targets h5 { margin: 0; font-size: 12px; color: var(--zwl-ink-soft); }
    .zwl-selection-target-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .zwl-selection-history-settings, .zwl-selection-general { padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid var(--zwl-rule); }
    .zwl-selection-settings .zwl-selection-history-settings .zwl-selection-settings-grid, .zwl-selection-settings .zwl-selection-general .zwl-selection-settings-grid { margin-top: 12px; padding-top: 0; border-top: 0; }
    .zwl-selection-target-row > label:has([data-field="aiProfileId"]) { flex: 2 1 220px; }
    .zwl-selection-targets > button { justify-self: start; }
    .zwl-selection-settings > .zwl-selection-setting-section { border-top: 0; padding-top: 0; margin-top: 0; }
    .zwl-selection-settings button[data-action="rules-save"] { background: #3d6b55; border-color: #3d6b55; color: #fffaf2; }
    .zwl-selection-settings button[data-action="rules-save"]:hover { background: #2e513f; }
    .zwl-selection-rule { padding: 14px; margin: 12px 0; background: var(--zwl-paper-soft); border: 1px solid var(--zwl-rule); border-inline-start: 3px solid var(--zwl-red); border-radius: 6px; }
    .zwl-selection-rule-header { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
    .zwl-selection-rule-header h4 { flex: 1 1 110px; margin: 0; font-size: 14px; }
    .zwl-selection-rule-fields { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
    .zwl-selection-settings [data-error="true"] { color: #873627; }
    .zwl-selection-results { min-width: 0; min-height: 0; }
    .zwl-selection-comparison { margin: 10px 0; padding: 10px; border: 1px solid var(--zwl-rule); border-radius: 6px; background: var(--zwl-paper-soft); }
    .zwl-selection-comparison h4 { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
    .zwl-selection-history { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--zwl-rule); min-width: 0; }
    .zwl-selection-history > summary { font-size: 14px; font-weight: 800; cursor: pointer; margin-bottom: 10px; }
    .zwl-selection-history input { display: block; width: 100%; margin: 4px 0 8px; }
    .zwl-selection-history > p { font-size: 11px; color: var(--zwl-ink-soft); }
    .zwl-selection-history-list { max-height: 420px; min-height: 0; overflow-y: auto; margin-bottom: 10px; }
    .zwl-selection-history-item { padding: 10px 0; border-bottom: 1px solid #e5d9c7; }
    .zwl-selection button.zwl-selection-history-open { display: block; width: 100%; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
    .zwl-selection-history-item p { margin: 5px 0; font-size: 11px; }
    .zwl-selection-history button { margin-inline-end: 6px; }
    .zwl-selection [hidden], .zwl-selection-settings [hidden] { display: none !important; }
    @media (max-width: 760px) { .zwl-selection-settings-grid, .zwl-selection-targets { grid-template-columns: minmax(0,1fr); } }
    @media (max-width: 440px) { .zwl-selection-rule-fields { grid-template-columns: minmax(0,1fr); } }
    @media (prefers-reduced-motion: reduce) { .zwl-selection *, .zwl-selection-settings * { transition: none !important; animation: none !important; } }
  `;
  (doc.head || doc.documentElement)!.appendChild(style);
  const cleanup = () => {
    style.remove();
    doc.defaultView?.removeEventListener("unload", cleanup);
    styleDocuments.delete(doc);
  };
  doc.defaultView?.addEventListener("unload", cleanup, { once: true });
  styleDocuments.set(doc, cleanup);
}
