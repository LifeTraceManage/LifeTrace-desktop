import rawChina from "@/src/assets/maps/china-provinces.json";
import rawCities from "@/src/assets/maps/china-cities.json";

type Position = [number, number];
type LinearRing = Position[];
type Polygon = LinearRing[];
type MultiPolygon = Polygon[];

type ProvinceFeature = {
  properties: {
    adcode: number | string;
    name: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: Polygon | MultiPolygon;
  };
};

type CityCenter = {
  id: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  lng: number;
  lat: number;
};

export type FootprintRegionMatch = {
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  cityName: string | null;
  cityDistanceKm: number | null;
};

const provinceFeatures = (
  rawChina as unknown as { features: ProvinceFeature[] }
).features.filter((feature) => /^\d{6}$/.test(String(feature.properties.adcode)));

const cityCenters = (
  rawCities as unknown as { cities: CityCenter[] }
).cities;

function pointInRing(longitude: number, latitude: number, ring: LinearRing): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const crosses = (currentLat > latitude) !== (previousLat > latitude)
      && longitude < (
        (previousLng - currentLng) * (latitude - currentLat)
        / ((previousLat - currentLat) || Number.EPSILON)
        + currentLng
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(longitude: number, latitude: number, polygon: Polygon): boolean {
  if (!polygon.length || !pointInRing(longitude, latitude, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(longitude, latitude, hole));
}

function featureContains(
  feature: ProvinceFeature,
  longitude: number,
  latitude: number,
): boolean {
  if (feature.geometry.type === "Polygon") {
    return pointInPolygon(longitude, latitude, feature.geometry.coordinates as Polygon);
  }
  return (feature.geometry.coordinates as MultiPolygon)
    .some((polygon) => pointInPolygon(longitude, latitude, polygon));
}

export function haversineKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const earthRadiusKm = 6371.0088;
  const dLatitude = (latitudeB - latitudeA) * Math.PI / 180;
  const dLongitude = (longitudeB - longitudeA) * Math.PI / 180;
  const aLatitude = latitudeA * Math.PI / 180;
  const bLatitude = latitudeB * Math.PI / 180;
  const value = Math.sin(dLatitude / 2) ** 2
    + Math.cos(aLatitude) * Math.cos(bLatitude) * Math.sin(dLongitude / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(value));
}

export function citiesForProvince(provinceCode: string): CityCenter[] {
  return cityCenters
    .filter((city) => city.provinceCode === provinceCode)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function findCityByName(
  provinceCode: string,
  cityName: string,
): CityCenter | null {
  const normalized = cityName.trim().replace(/[市地区盟州]$/u, "");
  if (!normalized) return null;
  return citiesForProvince(provinceCode).find((city) => {
    const cityNormalized = city.name.trim().replace(/[市地区盟州]$/u, "");
    return cityNormalized === normalized || city.name === cityName.trim();
  }) ?? null;
}

export function resolveCoordinates(
  latitude: number,
  longitude: number,
): FootprintRegionMatch | null {
  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  const feature = provinceFeatures.find((candidate) =>
    featureContains(candidate, longitude, latitude));
  if (!feature) return null;

  const provinceCode = String(feature.properties.adcode);
  const candidates = citiesForProvince(provinceCode);
  let nearest: { city: CityCenter; distance: number } | null = null;
  for (const city of candidates) {
    const distance = haversineKm(latitude, longitude, city.lat, city.lng);
    if (!nearest || distance < nearest.distance) nearest = { city, distance };
  }

  const city = nearest && nearest.distance <= 220 ? nearest.city : null;
  return {
    provinceCode,
    provinceName: feature.properties.name,
    cityCode: city?.cityCode ?? null,
    cityName: city?.name ?? null,
    cityDistanceKm: nearest ? Math.round(nearest.distance * 10) / 10 : null,
  };
}
