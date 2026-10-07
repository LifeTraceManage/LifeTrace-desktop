import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.storageApi) throw desktopBridgeError("存储管理");
  return window.storageApi;
}

export const desktopStorage = {
  available: () => typeof window !== "undefined" && Boolean(window.storageApi),
  status: (): Promise<StorageMigrationStatus> => api().status(),
  chooseAndMigrate: () => api().chooseAndMigrate(),
  restart: (): Promise<void> => api().restart(),
};
