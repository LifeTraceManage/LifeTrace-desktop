export async function desktopAppVersion(): Promise<string | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
