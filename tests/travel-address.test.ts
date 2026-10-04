import assert from "node:assert/strict";
import test from "node:test";
import { chinaTravelAddressLabel, groupChinaTravelAddresses, hasPlaceCoordinates, isChinaPlace } from "../src/components/feature/travel/travelAddress";
import type { TravelPlace } from "../src/services/travelApi";

function place(overrides: Partial<TravelPlace>): TravelPlace {
  return {
    id: "p1",
    name: "测试地点",
    placeType: "custom",
    visitCount: 0,
    photoCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("groups saved China addresses by province and city", () => {
  const groups = groupChinaTravelAddresses([
    place({ id: "a", name: "地点甲", countryCode: "CN", province: "福建省", city: "厦门市", latitude: 24.4, longitude: 118.1 }),
    place({ id: "b", name: "地点乙", country: "中国", province: "福建省", city: "厦门市", latitude: 24.5, longitude: 118.2 }),
    place({ id: "c", name: "地点丙", countryCode: "CN", province: "四川省", city: "成都市", latitude: 30.6, longitude: 104.0 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.flatMap((group) => group.cities.flatMap((city) => city.places)).length, 3);
});

test("excludes non-China and coordinate-less addresses from bindable list", () => {
  const groups = groupChinaTravelAddresses([
    place({ id: "a", countryCode: "US", latitude: 40, longitude: -74 }),
    place({ id: "b", countryCode: "CN", province: "福建省", city: "厦门市" }),
  ]);
  assert.deepEqual(groups, []);
});

test("address helpers keep legacy local places usable", () => {
  const legacy = place({ province: "浙江省", city: "杭州市", name: "西湖", latitude: 30.25, longitude: 120.15 });
  assert.equal(isChinaPlace(legacy), true);
  assert.equal(hasPlaceCoordinates(legacy), true);
  assert.equal(chinaTravelAddressLabel(legacy), "浙江省 · 杭州市 · 西湖");
});
