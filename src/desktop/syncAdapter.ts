import { desktopBridgeError } from "@/src/desktop/bridgeError";
import type {
  LocalProfile,
  SessionBindingResult,
  SyncConflictView,
  SyncRunReport,
  SyncStatusView,
} from "@/src/services/cloudSync";

function api() {
  if (typeof window === "undefined" || !window.syncApi) throw desktopBridgeError("同步服务");
  return window.syncApi;
}

export const desktopSync = {
  available: () => typeof window !== "undefined" && Boolean(window.syncApi),
  setSession: (origin: string, accessToken: string, deviceId: string): Promise<SessionBindingResult> =>
    api().setSession(origin, accessToken, deviceId),
  clearSession: (): Promise<void> => api().clearSession(),
  bindCurrentProfile: (): Promise<string> => api().bindCurrentProfile(),
  createCloudProfile: (displayName: string): Promise<string> => api().createCloudProfile(displayName),
  profiles: (): Promise<LocalProfile[]> => api().profiles(),
  setActiveProfile: (profileId: string): Promise<void> => api().setActiveProfile(profileId),
  status: (): Promise<SyncStatusView> => api().status(),
  now: (forceSnapshot = false): Promise<SyncRunReport> => api().now(forceSnapshot),
  conflicts: (): Promise<SyncConflictView[]> => api().conflicts(),
  resolveConflict: (
    conflictId: string,
    resolution: "accept_remote" | "keep_local" | "discard",
  ): Promise<void> => api().resolveConflict(conflictId, resolution),
};
