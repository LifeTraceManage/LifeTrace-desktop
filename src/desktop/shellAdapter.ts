import { invoke } from "@tauri-apps/api/core";
import { desktopBridgeError } from "@/src/desktop/bridgeError";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("desktop_open_url", { url });
    return;
  }
  if (typeof window === "undefined") throw desktopBridgeError("外部链接");
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("无法打开链接，请检查系统默认浏览器设置");
}
