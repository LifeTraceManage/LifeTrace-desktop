import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

const nativeFetch = window.fetch.bind(window);
const backendOrigin = "http://127.0.0.1:3103";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function relativeApiPath(input: RequestInfo | URL): string | undefined {
  if (typeof input === "string") {
    return input.startsWith("/api/") ? input : undefined;
  }
  if (input instanceof URL) {
    return input.origin === window.location.origin && input.pathname.startsWith("/api/")
      ? `${input.pathname}${input.search}`
      : undefined;
  }
  const url = new URL(input.url, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/")
    ? `${url.pathname}${url.search}`
    : undefined;
}

export function installTauriApiBridge() {
  if (!isTauriRuntime()) return;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const apiPath = relativeApiPath(input);
    if (!apiPath) return nativeFetch(input, init);

    const target = new URL(apiPath, backendOrigin);
    if (input instanceof Request) {
      return nativeFetch(new Request(target, input), init);
    }
    return nativeFetch(target, init);
  }) as typeof window.fetch;

  window.cloudCredentialApi = {
    set: (refreshToken) => invoke<void>("cloud_credential_set", { refreshToken }),
    get: () => invoke<string | null>("cloud_credential_get"),
    clear: () => invoke<void>("cloud_credential_clear"),
  };
  window.syncApi = {
    setSession: (origin, accessToken, deviceId) => invoke("sync_set_session", { origin, accessToken, deviceId }),
    clearSession: () => invoke<void>("sync_clear_session"),
    bindCurrentProfile: () => invoke<string>("sync_bind_current_profile"),
    createCloudProfile: (displayName) => invoke<string>("sync_create_cloud_profile", { displayName }),
    profiles: () => invoke("sync_profiles"),
    setActiveProfile: (profileId) => invoke<void>("sync_set_active_profile", { profileId }),
    status: () => invoke("sync_status"),
    now: (forceSnapshot = false) => invoke("sync_now", { forceSnapshot }),
    conflicts: () => invoke("sync_conflicts"),
    resolveConflict: (conflictId, resolution) => invoke<void>("sync_resolve_conflict", { conflictId, resolution }),
  };
  window.storageApi = {
    status: () => invoke<StorageMigrationStatus>("storage_status"),
    async chooseAndMigrate() {
      const targetPath = await open({
        multiple: false,
        directory: true,
        title: "选择新的 LifeTrace 存储文件夹",
      });
      if (!targetPath) return { canceled: true };
      try {
        const status = await invoke<StorageMigrationStatus>("storage_migrate", { targetPath });
        return { canceled: false, status };
      } catch (error) {
        return { canceled: false, error: String(error) };
      }
    },
    restart: () => relaunch(),
  };
  window.photoLibraryApi = {
    scan: () => invoke("photo_library_scan"),
    async addFolder() {
      const path = await open({
        directory: true,
        multiple: false,
        title: "选择要加入相册的照片文件夹",
      });
      if (!path) return { canceled: true };
      await invoke<void>("photo_library_add_folder", { path });
      return { canceled: false };
    },
    removeFolder: (path) => invoke<void>("photo_library_remove_folder", { path }),
    image: (path, kind) => invoke("photo_library_image", { path, kind }),
  };
  window.noteApi = {
    async selectAttachment(noteId) {
      const sourcePath = await open({ multiple: false, directory: false });
      if (!sourcePath) return { ok: false, canceled: true };
      try {
        const file = await invoke<Record<string, unknown>>("note_copy_attachment", { noteId, sourcePath });
        return { ok: true, file };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    async openAttachment(noteId, fileName) {
      try {
        return await invoke<{ok:boolean;error?:string}>("note_open_attachment", { noteId, fileName });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    async showAttachment(noteId, fileName) {
      try {
        return await invoke<{ok:boolean;error?:string}>("note_show_attachment", { noteId, fileName });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    async deleteAttachment(noteId, fileName) {
      try {
        return await invoke<{ok:boolean;error?:string}>("note_delete_attachment", { noteId, fileName });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    async exportNote(payload) {
      const extension = payload.format;
      const filePath = await save({
        defaultPath: `${payload.title.replace(/[<>:"/\\|?*]/g, "_") || "LifeTrace-note"}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      });
      if (!filePath) return { ok: false, canceled: true };
      try {
        await invoke("write_text_file", { path: filePath, content: payload.content });
        return { ok: true, filePath };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    async importMarkdown() {
      const filePath = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      });
      if (!filePath) return { ok: false, canceled: true };
      try {
        const content = await invoke<string>("read_text_file", { path: filePath });
        const title = filePath.split(/[\\/]/).pop()?.replace(/\.(md|markdown|txt)$/i, "");
        return { ok: true, title, content };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    onCommand: () => () => undefined,
  };
}

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export async function waitForTauriBackend(timeoutMilliseconds = 30_000) {
  if (!isTauriRuntime()) return;
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await nativeFetch(`${backendOrigin}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const payload = await response.json() as { ok?: boolean; runtime?: string };
        if (payload.ok && payload.runtime === "tauri-rust") return;
      }
      lastError = new Error(`本地服务返回 HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(
    `Rust 本地服务在 ${Math.round(timeoutMilliseconds / 1_000)} 秒内未能启动。${lastError instanceof Error ? ` ${lastError.message}` : ""}`,
  );
}
