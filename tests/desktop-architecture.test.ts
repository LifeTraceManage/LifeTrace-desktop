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
  const cloudWorkspace = read("src/components/DesktopCloudWorkspace.tsx");
  const cloudAgent = read("src/services/cloudAgentApi.ts");

  assert.doesNotMatch(localNavigation, /AI 管家|assistant/);
  assert.doesNotMatch(localSettings, /AISettingsPanel|DeepSeek/);
  assert.doesNotMatch(server, /mod assistant|\/api\/assistant\/chat|\/api\/settings\/ai/);

  assert.equal(existsSync("src/components/AIAssistantModule.tsx"), false);
  assert.equal(existsSync("src/components/AISettingsPanel.tsx"), false);
  assert.equal(existsSync("src-tauri/src/server/assistant.rs"), false);

  assert.match(cloudWorkspace, /CloudAgentModule/);
  assert.match(cloudAgent, /\/api\/v1\/web\/assistant/);
  assert.match(cloudAgent, /\/api\/v1\/assistant\/sessions/);
});

test("cloud transport is outside react components", () => {
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");
  const transport = read("src/services/cloudTransport.ts");

  assert.doesNotMatch(workspace, /@tauri-apps\/api\/core/);
  assert.doesNotMatch(workspace, /invoke</);
  assert.match(transport, /cloud_api_http_request/);
  assert.match(transport, /path\.startsWith\("\/api\/v1\/"\)/);
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
