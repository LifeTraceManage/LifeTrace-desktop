import type { TravelPlace } from "@/src/services/travelApi";

export type TravelAddressGroup = {
  province: string;
  cities: Array<{ city: string; places: TravelPlace[] }>;
};

const UNKNOWN_PROVINCE = "未分省";
const UNKNOWN_CITY = "未分城市";

export function isChinaPlace(place: TravelPlace) {
  const code = place.countryCode?.trim().toUpperCase();
  const country = place.country?.trim();
  return code === "CN" || country === "中国" || (!code && !country);
}

export function hasPlaceCoordinates(place: TravelPlace) {
  return typeof place.latitude === "number" && typeof place.longitude === "number";
}

export function groupChinaTravelAddresses(places: TravelPlace[]): TravelAddressGroup[] {
  const provinceMap = new Map<string, Map<string, TravelPlace[]>>();
  places
    .filter((place) => isChinaPlace(place) && hasPlaceCoordinates(place))
    .forEach((place) => {
      const province = place.province?.trim() || UNKNOWN_PROVINCE;
      const city = place.city?.trim() || UNKNOWN_CITY;
      let cityMap = provinceMap.get(province);
      if (!cityMap) {
        cityMap = new Map();
        provinceMap.set(province, cityMap);
      }
      const cityPlaces = cityMap.get(city) || [];
      cityPlaces.push(place);
      cityMap.set(city, cityPlaces);
    });

  return [...provinceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([province, cityMap]) => ({
      province,
      cities: [...cityMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
        .map(([city, cityPlaces]) => ({
          city,
          places: [...cityPlaces].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
        })),
    }));
}

export function chinaTravelAddressLabel(place: TravelPlace) {
  return [place.province, place.city, place.name].filter(Boolean).join(" · ");
}
