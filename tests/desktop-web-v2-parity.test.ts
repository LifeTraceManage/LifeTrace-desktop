import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("desktop cloud workspace uses a single compatibility boundary for web-shared pages", () => {
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");
  const compat = read("src/compat/webWorkspace.tsx");

  assert.match(workspace, /@\/src\/compat\/webWorkspace/);
  assert.match(workspace, /DesktopFeatureRouter/);
  assert.match(workspace, /setCloudFetchOverride\(desktopCloudFetch\)/);
  assert.doesNotMatch(workspace, /vendor\/web/);

  assert.match(compat, /vendor\/web\/src\/app\/AppContext/);
  assert.match(compat, /vendor\/web\/src\/app\/DesktopFeatureRouter/);
  assert.match(compat, /vendor\/web\/src\/services\/core/);
});

test("desktop native shell owns navigation while compatibility router supplies remaining feature pages", () => {
  const shell = read("src/components/DesktopWorkbenchShell.tsx");
  const router = read("vendor/web/src/app/DesktopFeatureRouter.tsx");
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");

  assert.doesNotMatch(shell, /web-client/);
  for (const route of [
    "/app/today",
    "/app/execution",
    "/app/calendar",
    "/app/habits",
    "/app/fitness",
    "/app/health",
    "/app/notes",
    "/app/review",
    "/app/finance",
    "/app/search",
    "/app/settings",
  ]) {
    assert.match(router, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(workspace, /path === "\/app\/assistant" \? <CloudAgentModule \/>/);
  assert.doesNotMatch(workspace, /AppShell/);
});

test("tauri entry loads web-shared styles only through the compatibility boundary", () => {
  const entry = read("tauri-ui/main.tsx");
  const styles = read("src/compat/webWorkspaceStyles.ts");

  assert.match(entry, /@\/src\/compat\/webWorkspaceStyles/);
  assert.doesNotMatch(entry, /vendor\/web\/src\/styles\/globals\.css/);
  assert.match(styles, /vendor\/web\/src\/styles\/globals\.css/);
  assert.doesNotMatch(entry, /web-client\/src/);
});
