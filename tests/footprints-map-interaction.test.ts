import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  clampPan,
  clampScale,
  clientPointToViewBox,
  isDragGesture,
  zoomAtPoint,
} from "../src/components/feature/footprints/mapInteraction";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("footprint map zoom keeps the pointer anchored and resets cleanly", () => {
  const zoomed = zoomAtPoint(
    { scale: 1, pan: { x: 0, y: 0 } },
    2,
    { x: 750, y: 380 },
    1000,
    760,
    2.5,
  );

  assert.equal(zoomed.scale, 2);
  assert.equal(zoomed.pan.x, -250);
  assert.equal(zoomed.pan.y, 0);

  const tx = (1 - zoomed.scale) * 1000 / 2 + zoomed.pan.x;
  const ty = (1 - zoomed.scale) * 760 / 2 + zoomed.pan.y;
  assert.equal(tx + 750 * zoomed.scale, 750);
  assert.equal(ty + 380 * zoomed.scale, 380);

  assert.deepEqual(
    zoomAtPoint(zoomed, 0.8, null, 1000, 760, 2.5),
    { scale: 1, pan: { x: 0, y: 0 } },
  );
});

test("footprint map camera clamps zoom, pan, and client coordinates", () => {
  assert.equal(clampScale(0.2, 1, 4), 1);
  assert.equal(clampScale(8, 1, 4), 4);
  assert.equal(clampScale(2.2, 1, 4), 2.2);

  assert.deepEqual(
    clientPointToViewBox(510, 390, {
      left: 10,
      top: 10,
      width: 1000,
      height: 760,
    }, 1000, 760),
    { x: 500, y: 380 },
  );

  assert.deepEqual(
    clampPan({ x: 5000, y: -5000 }, 2, 1000, 760),
    { x: 620, y: -471.2 },
  );
  assert.deepEqual(
    clampPan({ x: 20, y: 30 }, 1, 1000, 760),
    { x: 0, y: 0 },
  );
});

test("footprint map distinguishes a click from a drag", () => {
  assert.equal(isDragGesture({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(isDragGesture({ x: 10, y: 10 }, { x: 16, y: 10 }), true);
});

test("footprint map navigation is explicit rather than wheel-driven", () => {
  const map = read("src/components/feature/footprints/ChinaMap.tsx");
  const footprints = read("src/components/feature/footprints/Footprints.tsx");
  const drawer = read("src/components/feature/footprints/ProvinceDrawer.tsx");

  assert.doesNotMatch(map, /countryDrillScale/);
  assert.match(map, /event\.detail > 1/);
  assert.match(map, /onDoubleClickCapture=\{doubleClickProvince\}/);
  assert.match(map, /onEnterProvince/);
  assert.match(map, /data-admin-level="province"/);
  assert.doesNotMatch(map, /event\.detail >= 2/);
  assert.doesNotMatch(map, /isDoubleRegionActivation/);
  assert.doesNotMatch(map, /provinceActivationRef/);
  assert.doesNotMatch(map, /setLevel\(/);
  assert.match(map, /level: FootprintMapLevel/);
  assert.match(map, /\}, \[level\]\);/);
  assert.doesNotMatch(map, /\}, \[level, selectedProvinceCode\]\);/);
  assert.match(footprints, /const \[mapLevel, setMapLevel\]/);
  assert.match(footprints, /selected=\{Boolean\(selectedProvince\)\}/);
  assert.doesNotMatch(footprints, /selectedProvinceCodeRef/);
  assert.doesNotMatch(footprints, /onEnterProvinceMap/);
  assert.doesNotMatch(footprints, /enterProvinceMap/);
  assert.match(footprints, /setSelectedProvince\(null\)/);
  assert.match(footprints, /setProvinceDetail\(null\)/);
  assert.match(footprints, /setMapLevel\("country"\)/);
  assert.match(drawer, /selected: boolean/);
  assert.doesNotMatch(drawer, /查看省内地图/);
  assert.doesNotMatch(drawer, /先选择省份/);
  assert.doesNotMatch(drawer, /onEnterProvinceMap/);
  assert.doesNotMatch(drawer, /onBackToCountry/);
  assert.match(drawer, /双击地图上的省份/);
});


test("footprint map delays pointer capture until a real drag starts", () => {
  const map = read("src/components/feature/footprints/ChinaMap.tsx");
  const pointerDown = map.slice(
    map.indexOf("const pointerDown"),
    map.indexOf("const pointerMove"),
  );
  const pointerMove = map.slice(
    map.indexOf("const pointerMove"),
    map.indexOf("const pointerEnd"),
  );

  assert.doesNotMatch(pointerDown, /setPointerCapture/);
  assert.match(pointerMove, /isDragGesture/);
  assert.match(pointerMove, /drag\.moved = true/);
  assert.match(pointerMove, /setPointerCapture\(event\.pointerId\)/);
});


test("province double-click entry selects and enters atomically without prior selection", () => {
  const footprints = read("src/components/feature/footprints/Footprints.tsx");
  const selectProvince = footprints.slice(
    footprints.indexOf("const selectProvince"),
    footprints.indexOf("const chooseProvince"),
  );
  const enterProvince = footprints.slice(
    footprints.indexOf("const enterProvinceByCode"),
    footprints.indexOf("const filtered"),
  );

  assert.match(selectProvince, /setSelectedProvince\(\{ code, name \}\)/);
  assert.match(selectProvince, /if \(enterMap\) \{\s*setMapLevel\("province"\)/);
  assert.match(enterProvince, /selectProvince\(code, name, true\)/);
  assert.doesNotMatch(enterProvince, /selectedProvinceCodeRef/);
  assert.doesNotMatch(enterProvince, /chooseProvince/);
});
