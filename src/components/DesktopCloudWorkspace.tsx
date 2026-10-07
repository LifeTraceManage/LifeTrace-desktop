import { useCallback, useEffect, useMemo, useState } from "react";
import DesktopLocalToolsCenter from "@/src/components/DesktopLocalToolsCenter";
import DesktopNativeRouteContent from "@/src/components/DesktopNativeRouteContent";
import DesktopWorkbenchShell from "@/src/components/DesktopWorkbenchShell";
import { useDesktopNavigation } from "@/src/hooks/useDesktopNavigation";
import { useCloudAuthStore } from "@/src/stores/useCloudAuthStore";
import { useLifeStore } from "@/src/stores/useLifeStore";
import { desktopSync } from "@/src/desktop/syncAdapter";
import type { SyncStatusView } from "@/src/services/cloudSync";

function syncErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "string" && cause.trim()) return cause.trim();
  if (cause && typeof cause === "object" && "message" in cause) {
    const message = String((cause as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return "云端同步失败";
}

function hardSyncError(status: SyncStatusView | null): string {
  if (!status) return "";
  if (status.phase !== "error" && status.phase !== "auth_required") return "";
  return status.lastErrorMessage || status.lastErrorCode || "云端同步需要处理";
}

function syncStatusLabel(status: SyncStatusView | null): string {
  if (!status) return "已连接";
  switch (status.phase) {
    case "up_to_date": return status.pendingCount ? `待同步 ${status.pendingCount}` : "已同步";
    case "pushing": return "正在上传";
    case "pulling": return "正在下载";
    case "initializing_snapshot": return "初始化同步";
    case "backoff": return "自动重试中";
    case "offline": return "云端暂离线";
    case "conflict": return status.conflictCount ? `${status.conflictCount} 个冲突` : "有冲突";
    case "auth_required": return "需重新登录";
    case "error": return "同步异常";
    case "local_only": return "仅本机";
    default: return "已连接";
  }
}

export default function DesktopCloudWorkspace() {
  const user = useCloudAuthStore((value) => value.user);
  const authenticated = useCloudAuthStore((value) => value.authenticated);
  const phase = useCloudAuthStore((value) => value.phase);
  const authError = useCloudAuthStore((value) => value.error);
  const logoutNative = useCloudAuthStore((value) => value.logout);
  const ready = useLifeStore((value) => value.ready);
  const storageError = useLifeStore((value) => value.storageError);
  const initialize = useLifeStore((value) => value.initialize);
  const navigation = useDesktopNavigation();
  const cloudReady = authenticated && phase === "authenticated";

  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusView | null>(null);
  const [manualSyncError, setManualSyncError] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [localToolsOpen, setLocalToolsOpen] = useState(false);

  const reloadLocal = useCallback(async () => {
    await initialize();
  }, [initialize]);

  const refreshSyncStatus = useCallback(async () => {
    if (!desktopSync.available() || !cloudReady) {
      setSyncStatus(null);
      return null;
    }
    try {
      const status = await desktopSync.status();
      setSyncStatus(status);
      if (!hardSyncError(status)) setManualSyncError("");
      return status;
    } catch {
      return null;
    }
  }, [cloudReady]);

  const refresh = useCallback(async () => {
    if (!desktopSync.available()) {
      setManualSyncError("桌面同步服务尚未就绪");
      return;
    }
    if (!navigator.onLine || !cloudReady) {
      setNetworkOnline(navigator.onLine);
      setManualSyncError(
        navigator.onLine
          ? "云端会话暂不可用；本地数据仍可使用，恢复后会自动同步。"
          : "",
      );
      return;
    }
    setSyncing(true);
    setManualSyncError("");
    try {
      await desktopSync.now(false);
      await reloadLocal();
      await refreshSyncStatus();
    } catch (cause) {
      const status = await refreshSyncStatus();
      const hardError = hardSyncError(status);
      if (hardError) {
        setManualSyncError(hardError);
      } else if (!status) {
        setManualSyncError(syncErrorMessage(cause));
      }
      // Offline/backoff are retryable scheduler states, not permanent UI errors.
    } finally {
      setSyncing(false);
    }
  }, [cloudReady, reloadLocal, refreshSyncStatus]);

  useEffect(() => {
    void reloadLocal();
  }, [reloadLocal]);

  useEffect(() => {
    const online = () => {
      setNetworkOnline(true);
      void refresh();
    };
    const offline = () => {
      setNetworkOnline(false);
      setManualSyncError("");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready || !cloudReady) {
      setSyncStatus(null);
      return;
    }
    void refreshSyncStatus();
    const timer = window.setInterval(() => {
      void refreshSyncStatus();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [cloudReady, ready, refreshSyncStatus]);

  const statusError = hardSyncError(syncStatus);
  const visibleError = storageError || authError || statusError || manualSyncError || "";
  const statusLabel = useMemo(() => syncStatusLabel(syncStatus), [syncStatus]);

  if (!user) {
    return <div className="hx-loading"><span>LT</span><p>正在恢复桌面账号状态…</p></div>;
  }

  if (!ready) {
    return <div className="hx-loading"><span>LT</span><p>正在打开本机 SQLite 数据…</p></div>;
  }

  return (
    <DesktopWorkbenchShell
      route={navigation.route}
      titleOverride={localToolsOpen ? "本机工具" : undefined}
      descriptionOverride={localToolsOpen ? "SQLite、文件、日志与其他桌面专属能力。" : undefined}
      userLabel={user.displayName || user.email}
      online={networkOnline && cloudReady}
      loading={syncing}
      syncLabel={statusLabel}
      privacy={privacy}
      error={visibleError}
      onNavigate={(next) => {
        setLocalToolsOpen(false);
        navigation.navigate(next);
      }}
      onBack={() => {
        setLocalToolsOpen(false);
        navigation.back();
      }}
      onForward={() => {
        setLocalToolsOpen(false);
        navigation.forward();
      }}
      canBack={navigation.canBack}
      canForward={navigation.canForward}
      onRefresh={() => void refresh()}
      onTogglePrivacy={() => setPrivacy((value) => !value)}
      onLogout={() => void logoutNative()}
      onOpenLocalTools={() => setLocalToolsOpen(true)}
    >
      {localToolsOpen
        ? <DesktopLocalToolsCenter onClose={() => setLocalToolsOpen(false)} />
        : <DesktopNativeRouteContent route={navigation.route} navigate={navigation.navigate} />}
    </DesktopWorkbenchShell>
  );
}
