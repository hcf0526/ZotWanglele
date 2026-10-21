const STYLE_ID = "zwl-agent-chat-style";

const CSS = `
.zwl-agent-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  padding: 10px;
  color: var(--zwl-ink, #2b241e);
  background: var(--zwl-paper, #fbf8f0);
  font-family: var(--zwl-serif, "Source Han Serif SC", "Noto Serif CJK SC", serif);
}
.zwl-agent-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.zwl-agent-toolbar button,
.zwl-agent-composer button,
.zwl-agent-context-item button {
  appearance: none;
  -moz-appearance: none;
  box-sizing: border-box;
  border: 1px solid var(--zwl-rule, #d3c2a8);
  border-radius: 6px;
  padding: 4px 10px;
  color: var(--zwl-ink, #2b241e);
  background: var(--zwl-paper-soft, #fffaf2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.zwl-agent-toolbar button:hover,
.zwl-agent-composer button:hover,
.zwl-agent-context-item button:hover {
  border-color: var(--zwl-red, #b64b37);
  color: var(--zwl-red-deep, #873627);
}
.zwl-agent-toolbar button.primary,
.zwl-agent-composer button.primary {
  border-color: var(--zwl-red, #b64b37);
  color: #fffaf2;
  background: var(--zwl-red, #b64b37);
}
.zwl-agent-toolbar button:disabled,
.zwl-agent-composer button:disabled {
  opacity: 0.55;
  cursor: default;
}
.zwl-agent-context-panel {
  flex: none;
  max-height: 132px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--zwl-rule-soft, #e5d9c7);
  border-radius: 8px;
  background: var(--zwl-paper-soft, #fffaf2);
}
.zwl-agent-context-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 12px;
  font-weight: 700;
}
.zwl-agent-context-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.zwl-agent-context-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 4px 6px;
  border-left: 3px solid var(--zwl-plum, #69537e);
  background: var(--zwl-paper, #fbf8f0);
  font-size: 12px;
}
.zwl-agent-context-item[data-kind="text"] {
  border-left-color: var(--zwl-ochre, #ac762a);
}
.zwl-agent-context-item-main {
  flex: 1;
  min-width: 0;
}
.zwl-agent-context-label {
  color: var(--zwl-ink, #2b241e);
  word-break: break-word;
}
.zwl-agent-context-meta {
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 11px;
}
.zwl-agent-context-empty {
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 12px;
}
.zwl-agent-messages {
  flex: 1;
  min-height: 120px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--zwl-rule-soft, #e5d9c7);
  border-radius: 8px;
  background: var(--zwl-paper-deep, #f5ecdc);
}
.zwl-agent-message {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--zwl-rule-soft, #e5d9c7);
  background: var(--zwl-paper, #fbf8f0);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.zwl-agent-message[data-role="user"] {
  border-left: 3px solid var(--zwl-red, #b64b37);
}
.zwl-agent-message[data-role="assistant"] {
  border-left: 3px solid var(--zwl-moss, #3d6b55);
}
.zwl-agent-message[data-error="true"] {
  border-color: var(--zwl-danger, #b42318);
  color: var(--zwl-danger, #b42318);
}
.zwl-agent-message-meta {
  margin-bottom: 4px;
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 11px;
  font-weight: 700;
}
.zwl-agent-empty {
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 12px;
  text-align: center;
  padding: 18px 8px;
}
.zwl-agent-composer {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 6px;
}
.zwl-agent-composer textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 72px;
  resize: vertical;
  padding: 8px;
  border: 1px solid var(--zwl-rule, #d3c2a8);
  border-radius: 6px;
  color: var(--zwl-ink, #2b241e);
  background: #fffdf8;
  font: inherit;
  font-size: 13px;
}
.zwl-agent-composer textarea:focus-visible {
  outline: 2px solid var(--zwl-focus, #c87968);
  outline-offset: 1px;
}
.zwl-agent-composer-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  align-items: center;
}
.zwl-agent-status {
  flex: 1;
  min-width: 0;
  color: var(--zwl-ink-soft, #6c5d4f);
  font-size: 11px;
}
.zwl-agent-shell button:focus-visible,
.zwl-agent-composer textarea:focus-visible {
  outline: 2px solid var(--zwl-focus, #c87968);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .zwl-agent-shell * {
    transition: none !important;
    animation: none !important;
  }
}
`;

export function ensureAgentStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.documentElement ?? doc.createElement("html")).appendChild(style);
}
