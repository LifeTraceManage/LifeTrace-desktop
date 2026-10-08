import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("album opens the native Pictures library by default without a legacy imported-album tab", () => {
  const tabs = read("src/components/PhotoSyncModule.tsx");
  const gallery = read("src/components/LocalPhotoLibrary.tsx");
  assert.match(tabs, /useState<AlbumMode>\("local"\)/);
  assert.match(tabs, /<LocalPhotoLibrary\/>/);
  assert.doesNotMatch(tabs, /<PhotoSyncDashboard\/>/);
  assert.match(tabs, /<LocalVaultModule\/>/);
  assert.match(gallery, /desktopPhotoLibrary\.scan\(\)/);
  assert.match(gallery, /desktopPhotoLibrary\.addFolder\(\)/);
  assert.match(gallery, /desktopPhotoLibrary\.image\(photo\.path, "thumbnail"\)/);
  assert.match(gallery, /THUMB_CONCURRENCY = 4/);
});

test("native Pictures scanner is read-only and restricts preview paths to configured roots", () => {
  const rust = read("src-tauri/src/photo_library.rs");
  const lib = read("src-tauri/src/lib.rs");
  const bridge = read("tauri-ui/apiBridge.ts");
  assert.match(rust, /fn system_picture_folders\(/);
  assert.match(rust, /fn library_scan\(/);
  assert.match(rust, /fn image_from_library\(/);
  assert.match(rust, /canonical\.starts_with\(Path::new\(&root\.path\)\)/);
  assert.match(rust, /fn index_snapshot\(/);
  assert.match(rust, /read_exif_metadata_from_path/);
  assert.match(rust, /storage_type=\x27local\x27/);
  assert.match(rust, /sha256_file/);
  assert.match(rust, /remove_matching_managed_copy/);
  assert.match(rust, /footprint_entry_photos/);
  assert.doesNotMatch(rust, /fs::copy\(/);
  assert.match(lib, /photo_library::photo_library_scan/);
  assert.match(lib, /photo_library::photo_library_image/);
  assert.match(bridge, /photo_library_scan/);
  assert.match(bridge, /photo_library_add_folder/);
  assert.match(bridge, /photo_library_image/);
});

test("the album has no LAN upload, pairing or QR workflow", () => {
  const server = read("src-tauri/src/server.rs");
  const photoBackend = read("src-tauri/src/server/photo.rs");
  const savedAlbum = read("src/components/PhotoSyncDashboard.tsx");
  const bridge = read("tauri-ui/apiBridge.ts");
  assert.doesNotMatch(server, /serve_lan|serve_compatibility/);
  assert.doesNotMatch(photoBackend, /lan_dispatch|serve_lan|serve_compatibility|pairings/);
  assert.doesNotMatch(savedAlbum, /QRCode|createPairing|cancelPairing|扫描二维码/);
  assert.doesNotMatch(bridge, /photo_create_pairing|photo_set_compatibility/);
  assert.equal(existsSync("src-tauri/src/server/photo-upload.html"), false);
});

test("photo database retains local metadata and serves authorized local files", () => {
  const backend = read("src-tauri/src/server/photo.rs");
  assert.match(backend, /local_file_path TEXT/);
  assert.match(backend, /local_modified_at/);
  assert.match(backend, /storage_type/);
  assert.match(backend, /original_bytes_from_library/);
  assert.match(backend, /preview_bytes_from_library/);
});
