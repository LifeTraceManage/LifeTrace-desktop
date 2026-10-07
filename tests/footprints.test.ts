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

test("desktop navigation exposes Footprints in both local and signed-in shells", () => {
  const localNavigation = read("src/components/layout/navigation.ts");
  const workbench = read("src/components/DesktopWorkbenchShell.tsx");
  const nativeRoutes = read("src/components/DesktopNativeRouteContent.tsx");
  const router = read("vendor/web/src/app/DesktopFeatureRouter.tsx");

  assert.match(localNavigation, /"footprints"/);
  assert.match(localNavigation, /label: "足迹"/);
  assert.match(workbench, /path: "\/app\/footprints", label: "足迹"/);
  assert.match(nativeRoutes, /route === "\/app\/footprints"/);
  assert.match(nativeRoutes, /<Footprints \/>/);
  assert.match(router, /path="\/app\/footprints"/);
});

test("Footprints uses the shared photo catalog and local API instead of duplicating photos", () => {
  const migration = read("src-tauri/src/database/migrations/m0020_footprints.rs");
  const migrationRegistry = read("src-tauri/src/database/migrations/mod.rs");
  const repository = read("src-tauri/src/database/repositories/footprints.rs");
  const server = read("src-tauri/src/server.rs");
  const photo = read("src-tauri/src/server/photo.rs");

  assert.match(migration, /fn version\(&self\) -> i64 \{\s*20\s*\}/);
  assert.match(migration, /m0020-footprints-v1/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS footprint_entry_photos/);
  assert.doesNotMatch(migration, /CREATE TABLE(?: IF NOT EXISTS)? footprint_photos/);
  assert.match(migrationRegistry, /18\/19 intentionally remain unregistered/);
  assert.match(migrationRegistry, /M0020Footprints/);
  assert.match(repository, /JOIN photos p ON p\.id=ep\.photo_id/);
  assert.match(repository, /deleting an entry must never delete the photo/);
  assert.match(server, /"\/api\/footprints\/photo-suggestions"/);
  assert.match(photo, /trg_footprint_photo_soft_delete/);
  assert.match(photo, /photos_geo_idx/);
});

test("Footprints ships offline province and prefecture datasets with explicit hierarchical navigation", () => {
  const map = JSON.parse(read("src/assets/maps/china-provinces.json")) as {
    features: Array<{ properties: { adcode: number | string; name?: string } }>;
  };
  const prefectures = JSON.parse(read("src/assets/maps/china-prefectures.json")) as {
    features: Array<{ properties: { adcode: number | string; name?: string } }>;
  };
  const mapComponent = read("src/components/feature/footprints/ChinaMap.tsx");
  const codes = new Set(map.features.map((feature) => String(feature.properties.adcode)));
  const prefectureCodes = new Set(prefectures.features.map((feature) => String(feature.properties.adcode)));
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
  assert.ok(prefectureCodes.has("510100"), "成都 should have an offline city boundary");
  assert.ok(prefectureCodes.has("440100"), "广州 should have an offline city boundary");
  assert.match(mapComponent, /onWheel=\{wheel\}/);
  assert.match(mapComponent, /event\.preventDefault\(\)/);
  assert.doesNotMatch(mapComponent, /countryDrillScale/);
  assert.doesNotMatch(mapComponent, /enterProvince\(/);
  assert.match(mapComponent, /level: FootprintMapLevel/);
  assert.match(mapComponent, /onBackToCountry/);
  assert.match(mapComponent, /onEnterProvince/);
  assert.match(mapComponent, /event\.detail > 1/);
  assert.match(mapComponent, /onDoubleClick/);
  assert.doesNotMatch(mapComponent, /event\.detail >= 2/);
  assert.doesNotMatch(mapComponent, /isDoubleRegionActivation/);
  assert.match(mapComponent, /双击进入省内地图/);
  assert.match(mapComponent, /onSelectCity/);
  assert.match(mapComponent, /shortAdminName/);
  assert.match(mapComponent, /labelPoint/);
  assert.match(mapComponent, /footprint-map-admin-label/);
  assert.match(mapComponent, /footprint-map-visit-marker/);
  assert.match(mapComponent, /省级名称常驻显示/);
  assert.match(mapComponent, /市 \/ 地区名称常驻显示/);
  assert.equal(packageJson.dependencies["d3-geo"], "^3.1.1");
  assert.match(attribution, /Map of Us/);
  assert.match(attribution, /MIT License/);
  assert.match(entrypoint, /app\/footprints\.css/);
  const mapStyles = read("app/footprints.css");
  assert.match(mapStyles, /\.footprint-map-admin-name/);
  assert.match(mapStyles, /\.footprint-map-visit-count/);
});

test("Footprints keeps creation compact instead of rendering the oversized hero panel", () => {
  const component = read("src/components/feature/footprints/Footprints.tsx");
  const styles = read("app/footprints.css");

  assert.doesNotMatch(component, /footprint-hero/);
  assert.match(component, /footprint-add hx-btn primary/);
  assert.doesNotMatch(styles, /\.footprint-hero/);
  assert.match(styles, /height: clamp\(460px, calc\(100vh - 250px\), 650px\)/);
  assert.match(styles, /overscroll-behavior: contain/);
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


test("Footprints hierarchy navigation is double-click driven without a dedicated drill button", () => {
  const map = read("src/components/feature/footprints/ChinaMap.tsx");
  const drawer = read("src/components/feature/footprints/ProvinceDrawer.tsx");
  const page = read("src/components/feature/footprints/Footprints.tsx");

  assert.match(map, /onDoubleClick/);
  assert.match(map, /onEnterProvince/);
  assert.doesNotMatch(drawer, /查看省内地图/);
  assert.doesNotMatch(drawer, /先选择省份/);
  assert.doesNotMatch(page, /onEnterProvinceMap/);
});
