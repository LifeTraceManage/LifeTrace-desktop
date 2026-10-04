import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentSidebarProvider,
  AppRuntimeProvider,
  CloudDataStore,
  DesktopFeatureRouter,
  EMPTY_CLOUD_STATE,
  createPreference,
  setCloudFetchOverride,
  type AppContextValue,
  type CloudState,
  type EntityType,
  type JsonEntity,
  type ThemeMode,
  type WebSession,
} from "@/src/compat/webWorkspace";
import DesktopLocalToolsCenter from "@/src/components/DesktopLocalToolsCenter";
import DesktopFitnessImport from "@/src/components/DesktopFitnessImport";
import DesktopWorkbenchShell from "@/src/components/DesktopWorkbenchShell";
import PhotoSyncModule from "@/src/components/PhotoSyncModule";
import CloudAgentModule from "@/src/components/CloudAgentModule";
import { CLIENT_VERSION } from "@/src/services/cloudAuth";
import { desktopCloudFetch } from "@/src/services/cloudTransport";
import { setAppThemePreference } from "@/src/services/appPreferences";
import { useCloudAuthStore } from "@/src/stores/useCloudAuthStore";

setCloudFetchOverride(desktopCloudFetch);

function syncLocalReplica(): void {
  const api = window.syncApi;
  if (!api) return;
  void api.now(false).catch(() => undefined);
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return mode;
}

export default function DesktopCloudWorkspace() {
  const user = useCloudAuthStore((value) => value.user);
  const desktopSession = useCloudAuthStore((value) => value.session);
  const scopes = useCloudAuthStore((value) => value.scopes);
  const logoutNative = useCloudAuthStore((value) => value.logout);
  const [state, setState] = useState<CloudState>(EMPTY_CLOUD_STATE);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [localToolsOpen, setLocalToolsOpen] = useState(false);
  const storeRef = useRef<CloudDataStore | null>(null);

  const session = useMemo<WebSession | null>(() => {
    if (!user || !desktopSession) return null;
    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      session: {
        id: desktopSession.id,
        appId: desktopSession.appId,
        deviceId: desktopSession.deviceId,
        scopes: [...scopes],
        idleExpiresAt: desktopSession.absoluteExpiresAt,
        absoluteExpiresAt: desktopSession.absoluteExpiresAt,
        publicDevice: false,
      },
      csrfToken: "",
    };
  }, [desktopSession, scopes, user]);

  useEffect(() => {
    const wentOnline = () => setNetworkOnline(true);
    const wentOffline = () => setNetworkOnline(false);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    return () => {
      window.removeEventListener("online", wentOnline);
      window.removeEventListener("offline", wentOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!session) {
      storeRef.current = null;
      setState(EMPTY_CLOUD_STATE);
      setCloudLoaded(false);
      return () => { active = false; };
    }

    const store = new CloudDataStore(session.user.id, session.session.deviceId, "", desktopCloudFetch, {
      appId: session.session.appId,
      clientVersion: CLIENT_VERSION,
      platform: "windows",
    });
    storeRef.current = store;
    setLoading(true);
    setCloudLoaded(false);
    setError("");
    void store.load()
      .then((next) => {
        if (!active) return;
        setState(next);
        setCloudLoaded(true);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法加载云端数据");
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [session?.session.deviceId, session?.user.id]);

  useEffect(() => {
    if (!session || !cloudLoaded) return;
    const preference = Object.values(state.entities["user.preference"] ?? {})
      .find((item) => item.preferenceKey === "appearance.theme");
    const mode = preference?.value;
    const next: ThemeMode = mode === "dark" || mode === "light" || mode === "system" ? mode : "system";
    setThemeState(next);
    setAppThemePreference(resolveTheme(next));
  }, [cloudLoaded, session?.user.id, state]);

  const refresh = useCallback(async () => {
    const store = storeRef.current;
    if (!store || !navigator.onLine) return;
    setLoading(true);
    setError("");
    try {
      setState(await store.refresh());
      syncLocalReplica();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刷新失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const run = useCallback(async (action: (store: CloudDataStore) => Promise<CloudState>) => {
    const store = storeRef.current;
    if (!store) throw new Error("云端数据服务尚未就绪");
    if (!navigator.onLine) throw new Error("当前无网络，数据未保存");
    setLoading(true);
    setError("");
    try {
      const next = await action(store);
      setState(next);
      syncLocalReplica();
      return next;
    } catch (cause) {
      setState(store.snapshot());
      setError(cause instanceof Error ? cause.message : "云端操作失败");
      throw cause;
    } finally {
      setLoading(false);
    }
  }, []);

  const upsert = useCallback((entityType: EntityType, entity: JsonEntity) => run((store) => store.upsert(entityType, entity)), [run]);
  const remove = useCallback((entityType: EntityType, entityId: string) => run((store) => store.delete(entityType, entityId)), [run]);

  const setTheme = useCallback(async (mode: ThemeMode) => {
    setThemeState(mode);
    setAppThemePreference(resolveTheme(mode));
    if (!session || !networkOnline) return;
    const existing = Object.values(state.entities["user.preference"] ?? {})
      .find((item) => item.preferenceKey === "appearance.theme");
    const preference = existing
      ? { ...existing, value: mode }
      : createPreference(session.user.id, session.session.deviceId, "appearance.theme", mode);
    try { await upsert("user.preference", preference); }
    catch { /* Native appearance still applies if cloud persistence is unavailable. */ }
  }, [networkOnline, session, state.entities, upsert]);

  const logout = useCallback(async () => {
    await logoutNative();
  }, [logoutNative]);

  const login = useCallback(async () => {
    throw new Error("桌面端登录由原生账户入口管理");
  }, []);

  const appContext = useMemo<AppContextValue>(() => ({
    session,
    state,
    authLoading: false,
    loading,
    online: networkOnline,
    error,
    privacy,
    theme,
    login,
    logout,
    refresh,
    run,
    upsert,
    remove,
    setPrivacy,
    setTheme,
    clearError: () => setError(""),
  }), [error, loading, login, logout, networkOnline, privacy, refresh, remove, run, session, setTheme, state, theme, upsert]);

  if (!session) {
    return <div className="hx-loading"><span>LT</span><p>正在恢复桌面云会话…</p></div>;
  }

  return (
    <AppRuntimeProvider value={appContext}>
      <AgentSidebarProvider>
        <DesktopFeatureRouter
          render={({ path, navigate, content }) => (
            <DesktopWorkbenchShell
              route={path}
              titleOverride={localToolsOpen ? "本机工具" : undefined}
              descriptionOverride={localToolsOpen ? "SQLite 与其他仅桌面端提供的本机能力。" : undefined}
              userLabel={session.user.displayName || session.user.email}
              online={networkOnline}
              loading={loading}
              privacy={privacy}
              error={error}
              onNavigate={(next) => { setLocalToolsOpen(false); navigate(next); }}
              onRefresh={() => void refresh()}
              onTogglePrivacy={() => setPrivacy((value) => !value)}
              onLogout={() => void logout()}
              onOpenLocalTools={() => setLocalToolsOpen(true)}
            >
              {localToolsOpen
                ? <DesktopLocalToolsCenter onClose={() => setLocalToolsOpen(false)} />
                : path === "/app/assistant" ? <CloudAgentModule />
                  : path === "/app/photos" ? <PhotoSyncModule />
                    : path === "/app/fitness" ? <><DesktopFitnessImport />{content}</>
                      : content}
            </DesktopWorkbenchShell>
          )}
        />
      </AgentSidebarProvider>
    </AppRuntimeProvider>
  );
}
