import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop workbench provides native command and persistent layout behaviors", () => {
  const shell = readFileSync("src/components/DesktopWorkbenchShell.tsx", "utf8");

  assert.match(shell, /CommandPalette/);
  assert.match(shell, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(shell, /key === "k"/);
  assert.match(shell, /SIDEBAR_COMPACT_KEY/);
  assert.match(shell, /window\.localStorage\.setItem\(SIDEBAR_COMPACT_KEY/);
  assert.doesNotMatch(shell, /INSPECTOR_OPEN_KEY|lt-desk-inspector|桌面辅助面板/);
  assert.match(shell, /path: "\/app\/photos", label: "相册", icon: Images/);
  assert.match(shell, /打开本机工具/);
  assert.match(shell, /立即同步/);
  assert.match(shell, /开启隐私模式/);
});

test("desktop photos return to the primary navigation without duplicating the local tools page", () => {
  const routes = readFileSync("src/components/DesktopNativeRouteContent.tsx", "utf8");
  const localTools = readFileSync("src/components/DesktopLocalToolsCenter.tsx", "utf8");

  assert.match(routes, /route === "\/app\/photos"/);
  assert.match(routes, /<PhotoSyncModule \/>/);
  assert.doesNotMatch(localTools, /PhotoSyncModule|id: "photos"/);
});

test("finance is absent and fitness import stays in its own module", () => {
  const shell = readFileSync("src/components/DesktopWorkbenchShell.tsx", "utf8");
  const routes = readFileSync("src/components/DesktopNativeRouteContent.tsx", "utf8");
  const localTools = readFileSync("src/components/DesktopLocalToolsCenter.tsx", "utf8");
  const fitness = readFileSync("src/components/feature/fitness/Fitness.tsx", "utf8");

  assert.doesNotMatch(shell, /手动记账/);
  assert.doesNotMatch(shell, /\/app\/finance|label: "财务"/);
  assert.doesNotMatch(routes, /\/app\/finance/);
  assert.doesNotMatch(routes, /ImportBills/);
  assert.doesNotMatch(routes, /<Transactions|<Accounts/);
  assert.doesNotMatch(localTools, /训练和账单|健身数据/);
  assert.doesNotMatch(localTools, /ImportBills|账单导入/);
  assert.match(routes, /route === "\/app\/fitness"/);
  assert.match(fitness, /XunjiImportPanel/);
});

test("desktop restores and tracks native window placement without losing the visibility fallback", () => {
  const main = readFileSync("tauri-ui/main.tsx", "utf8");
  const state = readFileSync("tauri-ui/windowState.ts", "utf8");
  const fit = readFileSync("tauri-ui/windowFit.ts", "utf8");

  assert.match(main, /await restoreWindowPlacement\(\)/);
  assert.match(main, /installWindowPlacementPersistence\(\)/);
  assert.doesNotMatch(main, /void fitWindowToWorkArea\(\)/);

  assert.match(state, /monitorFromPoint/);
  assert.match(state, /primaryMonitor/);
  assert.match(state, /appWindow\.onMoved/);
  assert.match(state, /appWindow\.onResized/);
  assert.match(state, /appWindow\.isMaximized/);
  assert.match(state, /fitWindowToWorkArea/);
  assert.match(state, /WINDOW_STATE_KEY/);

  assert.match(fit, /currentMonitor/);
  assert.match(fit, /workArea/);
});
