import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sourceFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (/travel/i.test(path)) continue;
      result.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) result.push(path);
  }
  return result;
}

test("non-travel react components use service and desktop adapter boundaries", () => {
  const violations: string[] = [];
  for (const path of sourceFiles("src/components")) {
    const source = readFileSync(path, "utf8");
    if (/@tauri-apps\/api/.test(source)) violations.push(`${path}: imports Tauri API`);
    if (/\binvoke\s*\(/.test(source)) violations.push(`${path}: calls invoke()`);
    if (/\bfetch\s*\(/.test(source)) violations.push(`${path}: calls fetch()`);
    if (/window\.[A-Za-z][A-Za-z0-9_]*Api\b/.test(source)) {
      violations.push(`${path}: accesses window.*Api bridge`);
    }
  }
  assert.deepEqual(violations, []);
});

test("desktop platform capabilities are exposed through explicit adapters", () => {
  const adapters = [
    "src/desktop/appAdapter.ts",
    "src/desktop/credentialAdapter.ts",
    "src/desktop/noteAdapter.ts",
    "src/desktop/photoSyncAdapter.ts",
    "src/desktop/shellAdapter.ts",
    "src/desktop/storageAdapter.ts",
    "src/desktop/syncAdapter.ts",
    "src/desktop/vaultAdapter.ts",
  ];
  for (const path of adapters) {
    assert.ok(readFileSync(path, "utf8").length > 20, path + " is missing");
  }
});
