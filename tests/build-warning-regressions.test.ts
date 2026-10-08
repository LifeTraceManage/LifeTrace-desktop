import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("retired cloud photo staging importer does not emit Rust dead-code warnings", () => {
  assert.equal(existsSync("src-tauri/src/sync/photo_staging.rs"), false);
  assert.doesNotMatch(read("src-tauri/src/sync/mod.rs"), /mod photo_staging/);
  assert.doesNotMatch(read("src-tauri/src/server.rs"), /photo_runtime/);
  assert.doesNotMatch(read("src-tauri/src/desktop.rs"), /photo_runtime|photo::Runtime/);
  assert.doesNotMatch(read("src-tauri/src/server/photo.rs"), /fn read_exif_metadata\(/);
});

test("Tauri core IPC API is not both statically and dynamically imported", () => {
  for (const path of [
    "src/services/clientDiagnostics.ts",
    "src/services/clientObservability.ts",
  ]) {
    const source = read(path);
    assert.match(source, /import \{ invoke \} from "@tauri-apps\/api\/core"/);
    assert.doesNotMatch(source, /import\("@tauri-apps\/api\/core"\)/);
  }
});

test("desktop feature screens load on navigation instead of a single enormous entry chunk", () => {
  const source = read("src/components/DesktopNativeRouteContent.tsx");
  assert.match(source, /lazy\(\(\) => import\("@\/src\/components\/feature\/footprints\/Footprints"\)\)/);
  assert.match(source, /lazy\(\(\) => import\("@\/src\/components\/feature\/finance\/Finance"\)\)/);
  assert.match(source, /lazy\(\(\) => import\("@\/src\/components\/NotesModule"\)\)/);
  assert.match(source, /<Suspense fallback=/);
});
