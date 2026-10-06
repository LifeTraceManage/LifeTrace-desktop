import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.vaultApi) throw desktopBridgeError("私密相册");
  return window.vaultApi;
}

export const desktopVault = {
  available: () => typeof window !== "undefined" && Boolean(window.vaultApi),
  canHidePhotosFromSyncAlbum: () =>
    typeof window !== "undefined"
    && typeof window.vaultApi?.hidePhotosFromSyncAlbum === "function",
  status: (): Promise<VaultStatus> => api().status(),
  initialize: (password: string): Promise<VaultStatus> => api().initialize(password),
  unlock: (password: string): Promise<VaultStatus> => api().unlock(password),
  lock: (): Promise<VaultStatus> => api().lock(),
  listAssets: (options?: { trashed?: boolean; albumId?: string | null }): Promise<VaultAsset[]> =>
    api().listAssets(options),
  listAlbums: (): Promise<VaultAlbum[]> => api().listAlbums(),
  hidePhotosFromSyncAlbum: (photoIds: string[], albumId?: string | null) =>
    api().hidePhotosFromSyncAlbum(photoIds, albumId),
  restoreToSyncAlbum: (assetId: string): Promise<VaultAsset> => api().restoreToSyncAlbum(assetId),
  readAsset: (assetId: string): Promise<VaultAssetPayload> => api().readAsset(assetId),
  readThumbnail: (assetId: string): Promise<VaultThumbnailPayload> => api().readThumbnail(assetId),
  moveToTrash: (assetId: string): Promise<void> => api().moveToTrash(assetId),
  restoreAsset: (assetId: string): Promise<void> => api().restoreAsset(assetId),
  deleteAssetPermanently: (assetId: string): Promise<void> => api().deleteAssetPermanently(assetId),
  createAlbum: (name: string): Promise<VaultAlbum> => api().createAlbum(name),
  renameAlbum: (albumId: string, name: string): Promise<void> => api().renameAlbum(albumId, name),
  deleteAlbum: (albumId: string): Promise<void> => api().deleteAlbum(albumId),
  setAssetAlbum: (assetId: string, albumId: string, assigned: boolean): Promise<void> =>
    api().setAssetAlbum(assetId, albumId, assigned),
  verifyIntegrity: (): Promise<VaultIntegrityReport> => api().verifyIntegrity(),
  changePassword: (oldPassword: string, newPassword: string): Promise<VaultStatus> =>
    api().changePassword(oldPassword, newPassword),
  setAutoLock: (seconds: number): Promise<VaultStatus> => api().setAutoLock(seconds),
  setLockOnBlur: (enabled: boolean): Promise<VaultStatus> => api().setLockOnBlur(enabled),
  deleteAll: (confirmation: string): Promise<void> => api().deleteAll(confirmation),
};
