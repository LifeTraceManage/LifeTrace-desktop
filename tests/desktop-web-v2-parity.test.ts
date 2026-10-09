import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("authenticated desktop workspace is local-first and does not mount web frontend runtime", () => {
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");

  assert.match(workspace, /DesktopNativeRouteContent/);
  assert.match(workspace, /useLifeStore/);
  assert.match(workspace, /desktopSync\.now\(false\)/);
  assert.doesNotMatch(workspace, /vendor\/web|DesktopFeatureRouter|AppRuntimeProvider|CloudDataStore/);
});

test("native desktop route owns all primary non-travel product pages", () => {
  const routes = read("src/components/DesktopNativeRouteContent.tsx");

  for (const route of [
    "/app/today",
    "/app/execution",
    "/app/calendar",
    "/app/habits",
    "/app/fitness",
    "/app/health",
    "/app/review",
    "/app/photos",
    "/app/footprints",
    "/app/assistant",
    "/app/search",
    "/app/settings",
  ]) {
    assert.match(routes, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(routes, /<PhotoSyncModule \/>/);
  assert.match(routes, /<Footprints \/>/);
  assert.match(routes, /<CloudAgentModule \/>/);
  assert.match(routes, /<SettingsView \/>/);
  assert.doesNotMatch(routes, /vendor\/web|DesktopFeatureRouter/);
});

test("tauri entry and desktop typecheck no longer load web frontend page sources", () => {
  const entry = read("tauri-ui/main.tsx");
  const tsconfig = read("tsconfig.json");

  assert.doesNotMatch(entry, /vendor\/web|webWorkspaceStyles/);
  assert.doesNotMatch(tsconfig, /vendor\/web\/src/);
  assert.doesNotMatch(entry, /web-client\/src/);
});
