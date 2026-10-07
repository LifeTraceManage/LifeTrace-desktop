import type { FootprintEntry } from "./types";

export type FootprintYearStat = {
  year: string;
  visitCount: number;
  photoCount: number;
  favoriteCount: number;
};

export type FootprintPlaceStat = {
  label: string;
  visitCount: number;
  photoCount: number;
};

export type FootprintInsightsValue = {
  yearCount: number;
  revisitCount: number;
  photoCoveragePercent: number;
  years: FootprintYearStat[];
  topCities: FootprintPlaceStat[];
};

export function buildFootprintInsights(entries: FootprintEntry[]): FootprintInsightsValue {
  const years = new Map<string, FootprintYearStat>();
  const cities = new Map<string, FootprintPlaceStat>();
  const locations = new Set<string>();
  let entriesWithPhotos = 0;

  for (const entry of entries) {
    locations.add(entry.locationId);
    if (entry.photoCount > 0) entriesWithPhotos += 1;

    const year = entry.startedAt.slice(0, 4);
    const yearStat = years.get(year) ?? {
      year,
      visitCount: 0,
      photoCount: 0,
      favoriteCount: 0,
    };
    yearStat.visitCount += 1;
    yearStat.photoCount += entry.photoCount;
    yearStat.favoriteCount += Number(entry.favorite);
    years.set(year, yearStat);

    const city = entry.cityName?.trim() || entry.provinceName;
    const label = entry.cityName?.trim()
      ? `${entry.provinceName} · ${city}`
      : entry.provinceName;
    const cityStat = cities.get(label) ?? { label, visitCount: 0, photoCount: 0 };
    cityStat.visitCount += 1;
    cityStat.photoCount += entry.photoCount;
    cities.set(label, cityStat);
  }

  return {
    yearCount: years.size,
    revisitCount: Math.max(0, entries.length - locations.size),
    photoCoveragePercent: entries.length
      ? Math.round((entriesWithPhotos / entries.length) * 100)
      : 0,
    years: [...years.values()].sort((left, right) => right.year.localeCompare(left.year)),
    topCities: [...cities.values()]
      .sort((left, right) =>
        right.visitCount - left.visitCount
        || right.photoCount - left.photoCount
        || left.label.localeCompare(right.label))
      .slice(0, 5),
  };
}
