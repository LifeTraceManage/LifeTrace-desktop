import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ClientErrorBoundary from "@/src/components/ClientErrorBoundary";
import DesktopApp from "@/src/components/DesktopApp";
import { installAppPreferences, setAppThemePreference } from "@/src/services/appPreferences";
import { clientLogger, installGlobalErrorHandlers } from "@/src/services/clientObservability";
import { installDesktopContextMenuPolicy } from "@/src/services/contextMenuPolicy";
import { installGlobalFetchInstrumentation } from "@/src/services/fetchInstrumentation";
import { useLifeStore } from "@/src/stores/useLifeStore";
import { installTauriApiBridge, waitForTauriBackend } from "./apiBridge";
import { installVaultBridge } from "./vaultBridge";
import { installWindowPlacementPersistence, restoreWindowPlacement } from "./windowState";

/* Desktop-owned visual layers. The authenticated workspace no longer mounts
 * LifeTrace Web frontend pages; shared build dependencies are handled separately. */
import "@/app/tokens.css";
import "@/app/globals.css";
import "@/app/hengxu.css";
import "@/app/fitness-app.css";
import "@/app/xunji-import.css";
import "@/app/notes.css";
import "@/app/persist-project.css";
import "@/app/photo-sync.css";
import "@/app/footprints.css";
import "@/app/local-vault.css";
import "@/app/settings.css";
import "@/app/account-settings-redesign.css";
import "@/app/ui-menus.css";
import "@/app/auth-shell-fixes.css";
import "@/app/desktop-workspace.css";
import "@/app/execution.css";
import "@/app/execution-calendar.css";
import "@/app/analytics.css";
import "@/app/record-workspace.css";
import "@/app/module-layout-overrides.css";
import "@/app/apple-polish.css";
import "@/app/interaction-performance.css";
import "@/app/desktop-cloud-workspace.css";
import "@/app/cloud-agent.css";
import "@/app/desktop-local-tools.css";

installGlobalFetchInstrumentation();
installGlobalErrorHandlers();
installDesktopContextMenuPolicy();

const root = document.getElementById("root");
if (!root) throw new Error("LifeTrace root element is missing");

installAppPreferences();

useLifeStore.subscribe((state, previous) => {
  if (!state.ready) return;
  if (!previous.ready) {
    const renderedDark = document.documentElement.dataset.theme === "dark";
    if (state.dark && !renderedDark) {
      setAppThemePreference("dark");
      return;
    }
    if (!state.dark && renderedDark) {
      useLifeStore.setState({ dark: true });
      return;
    }
  }
  if (state.dark !== previous.dark) {
    setAppThemePreference(state.dark ? "dark" : "light");
  }
});

async function start() {
  await restoreWindowPlacement();
  void installWindowPlacementPersistence();
  installTauriApiBridge();
  installVaultBridge();
  root!.innerHTML = '<div class="hx-loading"><span>LT</span><p>正在启动 LifeTrace Desktop…</p></div>';
  clientLogger.info("desktop.start.begin");

  createRoot(root!).render(
    <StrictMode>
      <ClientErrorBoundary>
        <DesktopApp />
      </ClientErrorBoundary>
    </StrictMode>,
  );
  clientLogger.info("desktop.ui.ready");

  // The localhost Axum server is now a compatibility transport for remaining
  // modules. Core startup, auth, SQLite state, Notes and Search use Tauri IPC
  // and must not wait for this server.
  void waitForTauriBackend(10_000)
    .then(() => clientLogger.info("desktop.compat_backend.ready"))
    .catch((error) => {
      clientLogger.warn("desktop.compat_backend.unavailable", {
        impact: "legacy-local-http-features-only",
      }, error);
    });
}

void start();
