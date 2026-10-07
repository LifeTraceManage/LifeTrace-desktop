import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  filterFootprints,
  footprintDateLabel,
  footprintDisplayPlace,
  footprintVisitIntensity,
  groupFootprintsByYear,
} from "../src/components/feature/footprints/footprintViewModel";
import { buildFootprintInsights } from "../src/components/feature/footprints/footprintInsights";
import type { FootprintEntry } from "../src/components/feature/footprints/types";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

function entry(
  id: string,
  title: string,
  startedAt: string,
  cityName: string,
): FootprintEntry {
  return {
    id,
    locationId: `location-${id}`,
    title,
    description: title === "五一成都" ? "青城山和宽窄巷子" : null,
    startedAt,
    endedAt: startedAt,
    visitType: "trip",
    rating: null,
    favorite: false,
    createdAt: startedAt,
    updatedAt: startedAt,
    countryCode: "CN",
    countryName: "中国",
    provinceCode: cityName === "成都市" ? "510000" : "310000",
    provinceName: cityName === "成都市" ? "四川省" : "上海市",
    cityCode: null,
    cityName,
    districtCode: null,
    districtName: null,
    placeName: null,
    latitude: null,
    longitude: null,
    photoCount: 0,
    coverPhotoId: null,
  };
}

test("footprint view model groups, searches, labels, and shades records", () => {
  const entries = [
    entry("a", "五一成都", "2026-05-01", "成都市"),
    entry("b", "上海周末", "2025-08-09", "上海市"),
    entry("c", "成都再访", "2026-10-02", "成都市"),
  ];

  const groups = groupFootprintsByYear(entries);
  assert.deepEqual(groups.map((group) => group.year), ["2026", "2025"]);
  assert.deepEqual(groups[0].entries.map((value) => value.id), ["c", "a"]);
  assert.equal(filterFootprints(entries, "青城山").length, 1);
  assert.equal(filterFootprints(entries, "成都").length, 2);
  assert.equal(footprintDisplayPlace(entries[0]), "四川省 · 成都市");
  assert.equal(footprintDateLabel(entries[0]), "2026-05-01");
  assert.equal(footprintVisitIntensity(0, 5), 0);
  assert.equal(footprintVisitIntensity(1, 10), 0.25);
  assert.equal(footprintVisitIntensity(10, 10), 1);
});

test("footprint insights derive years, revisits, photo coverage, and top cities from real entries", () => {
  const entries = [
    { ...entry("a", "成都一", "2026-05-01", "成都市"), locationId: "chengdu", photoCount: 3 },
    { ...entry("b", "成都二", "2026-10-02", "成都市"), locationId: "chengdu", photoCount: 0, favorite: true },
    { ...entry("c", "上海", "2025-08-09", "上海市"), locationId: "shanghai", photoCount: 2 },
  ];
  const insights = buildFootprintInsights(entries);
  assert.equal(insights.yearCount, 2);
  assert.equal(insights.revisitCount, 1);
  assert.equal(insights.photoCoveragePercent, 67);
  assert.deepEqual(insights.years.map((year) => [year.year, year.visitCount]), [["2026", 2], ["2025", 1]]);
  assert.equal(insights.topCities[0].label, "四川省 · 成都市");
  assert.equal(insights.topCities[0].visitCount, 2);
});

test("desktop navigation exposes Footprints in both local and signed-in shells", () => {
  const localNavigation = read("src/components/layout/navigation.ts");
  const workbench = read("src/components/DesktopWorkbenchShell.tsx");
  const workspace = read("src/components/DesktopCloudWorkspace.tsx");
  const router = read("vendor/web/src/app/DesktopFeatureRouter.tsx");

  assert.match(localNavigation, /"footprints"/);
  assert.match(localNavigation, /label: "足迹"/);
  assert.match(workbench, /path: "\/app\/footprints", label: "足迹"/);
  assert.match(workspace, /path === "\/app\/footprints" \? <Footprints \/>/);
  assert.match(router, /path="\/app\/footprints"/);
});

test("Footprints uses the shared photo catalog and local API instead of duplicating photos", () => {
  const migration = read("src-tauri/src/database/migrations/m0018_footprints.rs");
  const repository = read("src-tauri/src/database/repositories/footprints.rs");
  const server = read("src-tauri/src/server.rs");
  const photo = read("src-tauri/src/server/photo.rs");

  assert.match(migration, /CREATE TABLE footprint_entry_photos/);
  assert.doesNotMatch(migration, /CREATE TABLE footprint_photos/);
  assert.match(repository, /JOIN photos p ON p\.id=ep\.photo_id/);
  assert.match(repository, /deleting an entry must never delete the photo/);
  assert.match(server, /"\/api\/footprints\/photo-suggestions"/);
  assert.match(photo, /trg_footprint_photo_soft_delete/);
  assert.match(photo, /photos_geo_idx/);
});

test("photo library can hand selected photos to a new Footprint draft", () => {
  const dashboard = read("src/components/PhotoSyncDashboard.tsx");
  const page = read("src/components/feature/footprints/Footprints.tsx");
  const bridge = read("src/components/feature/footprints/footprintPhotoDraft.ts");

  assert.match(dashboard, /添加到足迹/);
  assert.match(dashboard, /writeFootprintPhotoDraft/);
  assert.match(bridge, /FOOTPRINT_PHOTO_DRAFT_KEY/);
  assert.match(bridge, /sessionStorage/);
  assert.match(page, /consumeFootprintPhotoDraft/);
  assert.match(page, /photoIds: photoDraft\.photoIds/);
});

test("Footprints discovers unlinked GPS photo clusters before creating entries", () => {
  const repository = read("src-tauri/src/database/repositories/footprints.rs");
  const server = read("src-tauri/src/server.rs");
  const api = read("src/services/footprintApi.ts");
  const page = read("src/components/feature/footprints/Footprints.tsx");
  const discoveries = read("src/components/feature/footprints/FootprintDiscoveries.tsx");
  const editor = read("src/components/feature/footprints/FootprintEditor.tsx");

  assert.match(repository, /pub fn photo_discoveries/);
  assert.match(repository, /p\.latitude IS NOT NULL/);
  assert.match(repository, /JOIN footprint_entries e ON e\.id=ep\.entry_id/);
  assert.match(repository, /cluster\.photo_ids\.len\(\) >= 2/);
  assert.match(server, /"\/api\/footprints\/discoveries"/);
  assert.match(api, /discoveries: \(\) =>/);
  assert.match(page, /<FootprintDiscoveries/);
  assert.match(discoveries, /生成足迹/);
  assert.match(editor, /请选择省份/);
  assert.match(editor, /draft\?\.latitude/);
});

test("Footprints ships an offline China province dataset and Map of Us attribution", () => {
  const map = JSON.parse(read("src/assets/maps/china-provinces.json")) as {
    features: Array<{ properties: { adcode: number | string; name?: string } }>;
  };
  const codes = new Set(map.features.map((feature) => String(feature.properties.adcode)));
  const packageJson = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
  };
  const attribution = read("docs/third-party-map-of-us.md");
  const entrypoint = read("tauri-ui/main.tsx");

  assert.ok(codes.has("110000"));
  assert.ok(codes.has("510000"));
  assert.ok(codes.has("810000"));
  assert.ok(codes.has("820000"));
  assert.ok(codes.has("100000_JD"));
  assert.equal(packageJson.dependencies["d3-geo"], "^3.1.1");
  assert.match(attribution, /Map of Us/);
  assert.match(attribution, /MIT License/);
  assert.match(entrypoint, /app\/footprints\.css/);
});

test("legacy Travel PMTiles implementation is not part of the new Footprints path", () => {
  for (const path of [
    "src-tauri/src/lib.rs",
    "src-tauri/src/desktop.rs",
    "tauri-ui/apiBridge.ts",
    "src/types/electron.d.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /travel_offline_map|travelOfflineMapApi|offline-map\.pmtiles/);
  }
});
