import {
  downloadSettings,
  loadWebDavConfig,
  saveWebDavConfig,
  testWebDav,
  uploadSettings,
  type WebDavConfig,
} from "../sync/webdav";

export function mountSyncPanel(win: Window): () => void {
  const doc = win.document;
  const root = doc.getElementById("zotwanglele-sync-root");
  if (!root) return () => undefined;

  const url = doc.getElementById("zwl-sync-url") as HTMLInputElement | null;
  const username = doc.getElementById(
    "zwl-sync-username",
  ) as HTMLInputElement | null;
  const password = doc.getElementById(
    "zwl-sync-password",
  ) as HTMLInputElement | null;
  const remotePath = doc.getElementById(
    "zwl-sync-remote-path",
  ) as HTMLInputElement | null;
  const includeSecrets = doc.getElementById(
    "zwl-sync-include-secrets",
  ) as HTMLInputElement | null;
  const status = doc.getElementById("zwl-sync-status");
  const buttons = [
    doc.getElementById("zwl-sync-test"),
    doc.getElementById("zwl-sync-upload"),
    doc.getElementById("zwl-sync-download"),
  ].filter((button): button is HTMLButtonElement => !!button);
  if (!url || !username || !password || !remotePath || !includeSecrets) {
    ztoolkit.log("[SyncPanel] required fields are unavailable");
    return () => undefined;
  }

  const initial = loadWebDavConfig();
  url.value = initial.url;
  username.value = initial.username;
  password.value = initial.password;
  remotePath.value = initial.remotePath;
  includeSecrets.checked = initial.includeSecrets;

  const read = (): WebDavConfig => ({
    url: url.value.trim(),
    username: username.value.trim(),
    password: password.value,
    remotePath: remotePath.value.trim(),
    includeSecrets: includeSecrets.checked,
  });
  const setStatus = (message: string, state = "") => {
    if (!status) return;
    status.textContent = message;
    status.setAttribute("data-state", state);
  };
  let busy = false;
  const run = async (
    action: (value: WebDavConfig) => Promise<string>,
  ): Promise<void> => {
    if (busy) return;
    const value = read();
    saveWebDavConfig(value);
    busy = true;
    buttons.forEach((button) => (button.disabled = true));
    setStatus("处理中…", "checking");
    try {
      setStatus(await action(value), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
    } finally {
      busy = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  };

  const onTest = () =>
    void run(async (value) => {
      await testWebDav(value);
      return "WebDAV 服务可用";
    });
  const onUpload = () =>
    void run(async (value) => {
      const result = await uploadSettings(value);
      return `设置已上传，共 ${result.settingCount} 项${result.includeSecrets ? "，包含 API Key" : ""}`;
    });
  const onDownload = () =>
    void run(async (value) => {
      const result = await downloadSettings(value);
      return `设置已下载，共 ${result.settingCount} 项${result.includeSecrets ? "，包含 API Key" : ""}`;
    });

  doc.getElementById("zwl-sync-test")?.addEventListener("click", onTest);
  doc.getElementById("zwl-sync-upload")?.addEventListener("click", onUpload);
  doc
    .getElementById("zwl-sync-download")
    ?.addEventListener("click", onDownload);

  return () => {
    doc.getElementById("zwl-sync-test")?.removeEventListener("click", onTest);
    doc
      .getElementById("zwl-sync-upload")
      ?.removeEventListener("click", onUpload);
    doc
      .getElementById("zwl-sync-download")
      ?.removeEventListener("click", onDownload);
  };
}
