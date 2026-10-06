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
