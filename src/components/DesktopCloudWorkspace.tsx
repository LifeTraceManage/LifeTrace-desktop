import { useCallback, useEffect, useState } from "react";
import DesktopLocalToolsCenter from "@/src/components/DesktopLocalToolsCenter";
import DesktopNativeRouteContent from "@/src/components/DesktopNativeRouteContent";
import DesktopWorkbenchShell from "@/src/components/DesktopWorkbenchShell";
import { useDesktopNavigation } from "@/src/hooks/useDesktopNavigation";
import { useCloudAuthStore } from "@/src/stores/useCloudAuthStore";
import { useLifeStore } from "@/src/stores/useLifeStore";

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
  const [error, setError] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [localToolsOpen, setLocalToolsOpen] = useState(false);

  const reloadLocal = useCallback(async () => {
    await initialize();
  }, [initialize]);

  const refresh = useCallback(async () => {
    const sync = window.syncApi;
    if (!sync) {
      setError("桌面同步服务尚未就绪");
      return;
    }
    if (!navigator.onLine || !cloudReady) {
      setNetworkOnline(navigator.onLine);
      setError(
        navigator.onLine
          ? "云端会话暂不可用；本地数据仍可使用，恢复后会自动同步。"
          : "当前离线；本地数据仍可使用，联网后再同步。",
      );
      return;
    }
    setSyncing(true);
    setError("");
    try {
      await sync.now(false);
      await reloadLocal();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "云端同步失败");
    } finally {
      setSyncing(false);
    }
  }, [cloudReady, reloadLocal]);

  useEffect(() => {
    void reloadLocal();
  }, [reloadLocal]);

  useEffect(() => {
    const online = () => {
      setNetworkOnline(true);
      void refresh();
    };
    const offline = () => setNetworkOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready || !networkOnline || !cloudReady) return;
    void refresh();
  }, [cloudReady, ready, networkOnline, refresh]);

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
      privacy={privacy}
      error={storageError || error || authError || ""}
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
