import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.cloudCredentialApi) {
    throw desktopBridgeError("Windows 安全凭据存储");
  }
  return window.cloudCredentialApi;
}

export const desktopCredentials = {
  available: () => typeof window !== "undefined" && Boolean(window.cloudCredentialApi),
  set: (refreshToken: string): Promise<void> => api().set(refreshToken),
  get: (): Promise<string | null> =>
    typeof window !== "undefined" && window.cloudCredentialApi
      ? window.cloudCredentialApi.get()
      : Promise.resolve(null),
  clear: (): Promise<void> =>
    typeof window !== "undefined" && window.cloudCredentialApi
      ? window.cloudCredentialApi.clear()
      : Promise.resolve(),
};
