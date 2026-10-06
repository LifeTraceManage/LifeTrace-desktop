import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.photoSyncApi) throw desktopBridgeError("照片同步");
  return window.photoSyncApi;
}

export const desktopPhotoSync = {
  available: () => typeof window !== "undefined" && Boolean(window.photoSyncApi),
  status: (): Promise<PhotoSyncDesktopResponse> => api().status(),
  createPairing: (): Promise<PhotoSyncDesktopResponse> => api().createPairing(),
  cancelPairing: (pairCode: string): Promise<PhotoSyncDesktopResponse> => api().cancelPairing(pairCode),
  recover: (): Promise<PhotoSyncDesktopResponse> => api().recover(),
  exportCertificate: (): Promise<PhotoSyncDesktopResponse> => api().exportCertificate(),
  setCompatibilityMode: (enabled: boolean, confirmed?: boolean): Promise<PhotoSyncDesktopResponse> =>
    api().setCompatibilityMode(enabled, confirmed),
};
