import { desktopBridgeError } from "@/src/desktop/bridgeError";

export type LibraryPhoto = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};

export type LibraryRoot = {
  path: string;
  name: string;
  removable: boolean;
};

export type LibrarySnapshot = {
  roots: LibraryRoot[];
  photos: LibraryPhoto[];
  truncated: boolean;
};

export type LibraryImage = {
  mimeType: string;
  dataBase64: string;
};

function api() {
  if (typeof window === "undefined" || !window.photoLibraryApi) {
    throw desktopBridgeError("电脑图库");
  }
  return window.photoLibraryApi;
}

export const desktopPhotoLibrary = {
  available: () => typeof window !== "undefined" && Boolean(window.photoLibraryApi),
  scan: (): Promise<LibrarySnapshot> => api().scan(),
  addFolder: (): Promise<{ canceled: boolean }> => api().addFolder(),
  removeFolder: (path: string): Promise<void> => api().removeFolder(path),
  image: (path: string, kind: "thumbnail" | "preview"): Promise<LibraryImage> =>
    api().image(path, kind),
};
