import { config } from "../../../package.json";

type ConfirmDialogInput = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmDialogResult = {
  confirmed: boolean;
};

export function openConfirmDialog(
  parentWin: Window,
  input: ConfirmDialogInput,
): boolean {
  const result: ConfirmDialogResult = { confirmed: false };
  const url = `chrome://${config.addonRef}/content/confirm-dialog.xhtml`;
  try {
    (parentWin as any).openDialog(
      url,
      "zotwanglele-confirm-dialog",
      "chrome,centerscreen,modal,resizable=no",
      input,
      result,
    );
  } catch (error) {
    ztoolkit.log("[ConfirmDialog] open failed:", error);
    return false;
  }
  return result.confirmed;
}

export function onConfirmDialogLoad(win: Window): void {
  const args = (win as any).arguments;
  const input: ConfirmDialogInput = args?.[0] ?? {
    title: "确认操作",
    message: "请确认是否继续当前操作。",
  };
  const result: ConfirmDialogResult = args?.[1] ?? { confirmed: false };
  const doc = win.document;
  const title = doc.getElementById("zwl-confirm-title");
  const message = doc.getElementById("zwl-confirm-message");
  const confirmButton = doc.getElementById("zwl-confirm-apply");
  const cancelButton = doc.getElementById("zwl-confirm-cancel");

  if (title) title.textContent = input.title;
  if (message) message.textContent = input.message;
  if (input.confirmLabel)
    confirmButton?.setAttribute("label", input.confirmLabel);
  if (input.cancelLabel) cancelButton?.setAttribute("label", input.cancelLabel);

  (win as any).zwlConfirmDialogApply = () => {
    result.confirmed = true;
    win.close();
  };
  (win as any).zwlConfirmDialogCancel = () => {
    result.confirmed = false;
    win.close();
  };
}
