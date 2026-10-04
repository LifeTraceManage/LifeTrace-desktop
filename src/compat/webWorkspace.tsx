/**
 * Transitional compatibility boundary for the maintained web feature snapshot.
 *
 * Desktop components must import web-shared runtime pieces only through this
 * module. New desktop features should live under src/ and use desktop services.
 */
export {
  AppRuntimeProvider,
  type AppContextValue,
  type ThemeMode,
} from "../../vendor/web/src/app/AppContext";
export {
  DesktopFeatureRouter,
  type DesktopRouteBridge,
} from "../../vendor/web/src/app/DesktopFeatureRouter";
export { AgentSidebarProvider } from "../../vendor/web/src/features/assistant/AgentSidebarContext";
export {
  CloudDataStore,
  EMPTY_CLOUD_STATE,
  createPreference,
  setCloudFetchOverride,
  type CloudState,
  type EntityType,
  type JsonEntity,
  type WebSession,
} from "../../vendor/web/src/services/core";
