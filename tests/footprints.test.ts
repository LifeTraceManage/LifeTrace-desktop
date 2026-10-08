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

test("Footprints uses Map of Us province boundaries and city points for hierarchical navigation", () => {
  const map = JSON.parse(read("src/assets/maps/china-provinces.json")) as {
    features: Array<{ properties: { adcode: number | string; name?: string } }>;
  };
  const cityPoints = JSON.parse(read("src/assets/maps/china-city-points.json")) as {
    source: string;
    license: string;
    cities: Array<{
      id: string;
      name: string;
      provinceCode: string;
      cityCode: string | null;
      longitude: number;
      latitude: number;
    }>;
  };
  const mapComponent = read("src/components/feature/footprints/ChinaMap.tsx");
  const codes = new Set(map.features.map((feature) => String(feature.properties.adcode)));
  const packageJson = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
  };
  const attribution = read("docs/third-party-map-of-us.md");
  const entrypoint = read("tauri-ui/main.tsx");

  assert.ok(codes.has("110000"));
  assert.ok(codes.has("330000"));
  assert.ok(codes.has("360000"));
  assert.ok(codes.has("510000"));
  assert.ok(codes.has("810000"));
  assert.ok(codes.has("820000"));
  assert.ok(codes.has("100000_JD"));

  assert.equal(cityPoints.source, "WuSuBuDuoMing/map data/cities.ts");
  assert.equal(cityPoints.license, "MIT");
  assert.ok(cityPoints.cities.length >= 390);

  const zhejiang = cityPoints.cities.filter((city) => city.provinceCode === "330000");
  const jiangxi = cityPoints.cities.filter((city) => city.provinceCode === "360000");
  assert.equal(zhejiang.length, 11);
  assert.equal(jiangxi.length, 11);
  assert.ok(zhejiang.some((city) => city.name === "杭州"));
  assert.ok(zhejiang.some((city) => city.name === "舟山"));
  assert.ok(jiangxi.some((city) => city.name === "南昌"));
  assert.ok(jiangxi.some((city) => city.name === "赣州"));

  assert.match(mapComponent, /china-city-points\.json/);
  assert.doesNotMatch(mapComponent, /china-prefectures\.json/);
  assert.doesNotMatch(mapComponent, /rawPrefectures/);
  assert.match(mapComponent, /footprint-map-province-outline/);
  assert.match(mapComponent, /footprint-map-city-node/);
  assert.match(mapComponent, /projection\(\[city\.longitude, city\.latitude\]\)/);
  assert.match(mapComponent, /onWheel=\{wheel\}/);
  assert.match(mapComponent, /event\.preventDefault\(\)/);
  assert.doesNotMatch(mapComponent, /countryDrillScale/);
  assert.match(mapComponent, /level: FootprintMapLevel/);
  assert.match(mapComponent, /onBackToCountry/);
  assert.match(mapComponent, /onEnterProvince/);
  assert.match(mapComponent, /event\.detail > 1/);
  assert.match(mapComponent, /onDoubleClickCapture=\{doubleClickProvince\}/);
  assert.match(mapComponent, /双击省份进入省内地图/);
  assert.match(mapComponent, /onSelectCity/);
  assert.match(mapComponent, /shortAdminName/);
  assert.match(mapComponent, /footprint-map-admin-label/);
  assert.match(mapComponent, /footprint-map-visit-marker/);
  assert.equal(packageJson.dependencies["d3-geo"], "^3.1.1");
  assert.match(attribution, /Map of Us/);
  assert.match(attribution, /china-city-points\.json/);
  assert.match(attribution, /ProvinceMap/);
  assert.match(attribution, /MIT License/);
  assert.match(entrypoint, /app\/footprints\.css/);

  const mapStyles = read("app/footprints.css");
  assert.match(mapStyles, /\.footprint-map-city-node/);
  assert.match(mapStyles, /\.footprint-map-province-outline/);
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

  assert.match(map, /onDoubleClickCapture=\{doubleClickProvince\}/);
  assert.match(map, /onEnterProvince/);
  assert.doesNotMatch(drawer, /查看省内地图/);
  assert.doesNotMatch(drawer, /先选择省份/);
  assert.doesNotMatch(page, /onEnterProvinceMap/);
});

test("Footprints photo picker uses the gallery's local file time without changing GPS suggestion rank", () => {
  const repository = read("src-tauri/src/database/repositories/footprints.rs");
  const picker = read("src/components/feature/footprints/FootprintPhotoPicker.tsx");
  const types = read("src/components/feature/footprints/types.ts");
  const library = read("src-tauri/src/photo_library.rs");

  assert.match(library, /photos\.sort_by\(\|a, b\| b\.modified_at\.cmp\(&a\.modified_at\)/);
  assert.match(repository, /local_modified_at \/ 1000000000/);
  assert.match(repository, /COALESCE\(local_file_path,original_file_name\) ASC,id ASC/);
  assert.match(repository, /photo_picker_matches_local_library_modified_time_and_keeps_legacy_fallback/);
  assert.match(picker, /photo\.modifiedAt != null/);
  assert.match(picker, /photo\.modifiedAt \* 1000/);
  assert.match(picker, /toLocaleString\("zh-CN", \{ hour12: false \}\)/);
  assert.match(types, /modifiedAt\?: number \| null/);

  // Existing suggestion ranking and linked-photo manual ordering are unchanged.
  assert.match(repository, /suggestions\.sort_by\(\|left, right\|/);
  assert.match(repository, /ORDER BY ep\.is_cover DESC,ep\.sort_order ASC,ep\.photo_id ASC/);
});
