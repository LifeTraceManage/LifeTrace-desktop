import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("desktop notes prefer tauri commands while browser compatibility stays behind the service", () => {
  const api = read("src/services/noteApi.ts");
  const commands = read("src-tauri/src/commands/notes.rs");
  const application = read("src-tauri/src/application/notes.rs");
  const httpAdapter = read("src-tauri/src/server/notes.rs");

  assert.match(api, /invoke<T>\("notes_query"/);
  assert.match(api, /invoke<T>\("notes_mutate"/);
  assert.match(api, /isTauriRuntime/);

  assert.match(commands, /application::notes::query/);
  assert.match(commands, /application::notes::mutate/);
  assert.match(commands, /signal_local_change/);

  assert.match(httpAdapter, /application::notes::query/);
  assert.match(httpAdapter, /application::notes::mutate/);
  assert.doesNotMatch(httpAdapter, /notes_repo::/);

  assert.match(application, /notes_repo::save_note/);
  assert.match(application, /notes_repo::list_notes/);
});

test("local agent implementation is removed and desktop assistant points at cloud agent", () => {
  const localNavigation = read("src/components/layout/navigation.ts");
  const localSettings = read("src/components/feature/settings/SettingsView.tsx");
  const server = read("src-tauri/src/server.rs");
  const nativeRoutes = read("src/components/DesktopNativeRouteContent.tsx");
  const cloudAgent = read("src/services/cloudAgentApi.ts");

  assert.doesNotMatch(localNavigation, /AI 管家|assistant/);
  assert.doesNotMatch(localSettings, /AISettingsPanel|DeepSeek/);
  assert.doesNotMatch(server, /mod assistant|\/api\/assistant\/chat|\/api\/settings\/ai/);

  assert.equal(existsSync("src/components/AIAssistantModule.tsx"), false);
  assert.equal(existsSync("src/components/AISettingsPanel.tsx"), false);
  assert.equal(existsSync("src-tauri/src/server/assistant.rs"), false);

  assert.match(nativeRoutes, /route === "\/app\/assistant"/);
  assert.match(nativeRoutes, /<CloudAgentModule \/>/);
  assert.match(cloudAgent, /\/api\/v1\/web\/assistant/);
  assert.match(cloudAgent, /\/api\/v1\/assistant\/sessions/);
});

test("cloud transport is outside react components", () => {
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");
  const transport = read("src/services/cloudTransport.ts");

  assert.doesNotMatch(workspace, /@tauri-apps\/api\/core/);
  assert.doesNotMatch(workspace, /invoke</);
  assert.match(transport, /cloud_api_http_request/);
  assert.match(transport, /url\.pathname\.startsWith\("\/api\/v1\/"\)/);
});


test("core local state uses tauri commands and shared application service", () => {
  const client = read("src/db/sqliteClient.ts");
  const commands = read("src-tauri/src/commands/state.rs");
  const application = read("src-tauri/src/application/state.rs");
  const adapter = read("src-tauri/src/server/state.rs");

  assert.match(client, /invoke<LifeData>\("state_get"/);
  assert.match(client, /invoke<\{ ok: true \}>\("state_mutate"/);
  assert.match(commands, /spawn_blocking/);
  assert.match(commands, /signal_local_change/);
  assert.match(adapter, /application::state::load/);
  assert.match(adapter, /application::state::mutate/);
  assert.doesNotMatch(adapter, /finance::|habits::|workouts::/);
  assert.match(application, /finance::save_transaction/);
  assert.match(application, /habits::save_activity/);
  assert.match(application, /workouts::save_workout/);
});


test("analytics search uses tauri ipc while http routes remain compatibility adapters", () => {
  const api = read("src/services/analyticsApi.ts");
  const commands = read("src-tauri/src/commands/analytics.rs");
  const application = read("src-tauri/src/application/analytics.rs");
  const adapter = read("src-tauri/src/server/analytics.rs");

  assert.match(api, /invoke<T>\("analytics_query"/);
  assert.match(api, /isTauriRuntime/);
  assert.match(commands, /application::analytics::query/);
  assert.match(commands, /spawn_blocking/);
  assert.match(application, /analytics_repo::search/);
  assert.match(adapter, /application::analytics::query/);
  assert.doesNotMatch(adapter, /profile::active_profile_id|analytics_repo::search\(/);
});

test("execution desktop requests use tauri ipc while browser compatibility stays behind the service", () => {
  const api = read("src/services/executionApi.ts");
  const commands = read("src-tauri/src/commands/execution.rs");
  const server = read("src-tauri/src/server.rs");
  const lib = read("src-tauri/src/lib.rs");

  assert.match(api, /execution_api_request/);
  assert.match(api, /isTauriRuntime/);
  assert.match(commands, /server::execution_ipc_router/);
  assert.match(commands, /ServiceExt/);
  assert.match(commands, /signal_local_change/);
  assert.match(server, /fn execution_routes\(\) -> Router<AppState>/);
  assert.match(server, /pub\(crate\) fn execution_ipc_router/);
  assert.match(lib, /commands::execution::execution_api_request/);
});

test("footprints and photo dashboard use the restricted local JSON IPC transport", () => {
  const footprints = read("src/services/footprintApi.ts");
  const photos = read("src/services/photoSyncApi.ts");
  const transport = read("src/services/localJsonTransport.ts");
  const commands = read("src-tauri/src/commands/local_api.rs");
  const server = read("src-tauri/src/server.rs");
  const lib = read("src-tauri/src/lib.rs");

  assert.match(footprints, /localJsonRequest/);
  assert.match(photos, /localJsonRequest/);
  assert.match(transport, /local_json_api_request/);
  assert.match(transport, /isTauriRuntime/);
  assert.match(commands, /\/api\/footprints\//);
  assert.match(commands, /\/api\/photo-sync\/dashboard/);
  assert.doesNotMatch(commands, /starts_with\("\/api\/"\)/);
  assert.match(commands, /server::local_json_ipc_router/);
  assert.match(commands, /signal_local_change/);
  assert.match(server, /fn local_json_routes\(\) -> Router<AppState>/);
  assert.match(server, /pub\(crate\) fn local_json_ipc_router/);
  assert.match(lib, /commands::local_api::local_json_api_request/);
});

test("xunji desktop import uses raw tauri IPC for image bytes and JSON IPC for confirmation", () => {
  const api = read("src/services/xunjiImportApi.ts");
  const commands = read("src-tauri/src/commands/xunji.rs");
  const localApi = read("src-tauri/src/commands/local_api.rs");
  const server = read("src-tauri/src/server/xunji.rs");
  const lib = read("src-tauri/src/lib.rs");

  assert.match(api, /xunji_parse_image/);
  assert.match(api, /Uint8Array/);
  assert.match(api, /localJsonRequest/);
  assert.match(commands, /InvokeBody::Raw/);
  assert.match(commands, /server::xunji::parse_image_bytes/);
  assert.match(commands, /signal_local_change/);
  assert.match(localApi, /\/api\/xunji\/imports/);
  assert.match(server, /pub\(crate\) async fn parse_image_bytes/);
  assert.match(lib, /commands::xunji::xunji_parse_image/);
});

test("desktop build no longer bootstraps vendor web dependencies", () => {
  const packageJson = read("package.json");
  const vite = read("vite.tauri.config.ts");
  const ci = read(".github/workflows/ci.yml");
  const release = read(".github/workflows/release-windows.yml");

  assert.doesNotMatch(packageJson, /prepare:web-shared|ensure-shared-web-deps/);
  assert.doesNotMatch(vite, /vendor.*web|webRoot|maplibre-gl|pmtiles/);
  assert.doesNotMatch(ci, /prepare:web-shared/);
  assert.doesNotMatch(release, /prepare:web-shared/);
  assert.equal(existsSync("scripts/ensure-shared-web-deps.mjs"), false);
});

test("desktop startup renders before probing the localhost compatibility server", () => {
  const main = read("tauri-ui/main.tsx");
  assert.match(main, /createRoot\(root!\)\.render/);
  assert.match(main, /void waitForTauriBackend\(10_000\)/);
  assert.doesNotMatch(main, /await waitForTauriBackend\(/);
});

test("offline authenticated identity keeps the same native desktop workspace", () => {
  const app = read("src/components/DesktopApp.tsx");
  assert.match(app, /phase === "offline"/);
  assert.match(app, /<DesktopCloudWorkspace \/>/);
  assert.doesNotMatch(app, /HengXuShell|cloudAvailable/);
});


test("desktop mail is a native route backed by the cloud API service", () => {
  const routes = read("src/components/DesktopNativeRouteContent.tsx");
  const shell = read("src/components/DesktopWorkbenchShell.tsx");
  const mail = read("src/components/feature/mail/MailActionCenter.tsx");
  const api = read("src/services/mailApi.ts");

  assert.match(shell, /path: "\/app\/mail", label: "邮件"/);
  assert.match(routes, /import MailActionCenter from "@\/src\/components\/feature\/mail\/MailActionCenter"/);
  assert.match(routes, /route === "\/app\/mail"/);
  assert.match(routes, /<MailActionCenter \/>/);
  assert.match(api, /cloudAuthClient\.request/);
  assert.match(api, /\/api\/v1\/mail\/accounts/);
  assert.doesNotMatch(routes, /vendor\/web/);
  assert.doesNotMatch(mail, /vendor\/web|MailPage/);
});

test("desktop sync retires entity types no longer accepted by cloud", () => {
  const migration = read("src-tauri/src/database/migrations/m0021_sync_registry_alignment.rs");
  const registry = read("vendor/shared/crates/lifetrace-contracts/src/registry.rs");
  const migrationRegistry = read("src-tauri/src/database/migrations/mod.rs");

  assert.match(migration, /DROP TRIGGER IF EXISTS/);
  assert.match(migration, /execution\.memo/);
  assert.match(migration, /travel\.trip/);
  assert.match(migration, /DELETE FROM \{table\} WHERE entity_type/);
  assert.match(registry, /const fn device_local/);
  assert.match(registry, /device_local\(EntityType::EXECUTION_MEMO\)/);
  assert.match(registry, /device_local\(EntityType::TRAVEL_TRIP\)/);
  assert.match(migrationRegistry, /M0021SyncRegistryAlignment/);
});

test("desktop execution center keeps native extras and restores web execution workflow views", () => {
  const module = read("src/components/feature/execution/ExecutionModule.tsx");
  const routes = read("src/components/DesktopNativeRouteContent.tsx");
  const api = read("src/services/executionApi.ts");

  for (const view of ["planner", "inbox", "habits", "focus", "review"]) {
    assert.match(module, new RegExp(`["']${view}["']`), `missing execution view: ${view}`);
  }
  assert.match(module, /executionApi\.focusSessions\.create/);
  assert.match(module, /useLifeStore/);
  assert.match(module, /renderMemos/);
  assert.match(module, /CalendarWorkspace/);
  assert.match(routes, /<ExecutionModule onNavigate=\{navigate\} \/>/);
  assert.match(api, /execution_api_request/);
  assert.doesNotMatch(module, /vendor\/web/);
});


test("collapsed desktop sidebar keeps an explicit reopen action in the command bar", () => {
  const shell = read("src/components/DesktopWorkbenchShell.tsx");

  assert.match(shell, /sidebarCompact \? \(/);
  assert.match(shell, /className="lt-desk-sidebar-reopen"/);
  assert.match(shell, /title="展开侧栏"/);
  assert.match(shell, /onClick=\{\(\) => setSidebar\(false\)\}/);
});


test("desktop mail uses a bounded workspace so wheel scrolling reaches the message list", () => {
  const shell = read("src/components/DesktopWorkbenchShell.tsx");
  const styles = read("app/desktop-cloud-workspace.css");
  const mail = read("src/components/feature/mail/MailActionCenter.tsx");

  assert.match(shell, /routeIsActive\(route, "\/app\/mail"\).*mail-route/);
  assert.match(styles, /\.lt-desk-content\.mail-route\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(styles, /\.lt-desk-content\.mail-route > \.lt-desk-route-content\s*\{[\s\S]*min-height:\s*0;[\s\S]*height:\s*100%;/);
  assert.match(mail, /overflowY:\s*"auto"/);
  assert.match(mail, /gridTemplateRows:\s*"auto minmax\(0, 1fr\)"/);
});
