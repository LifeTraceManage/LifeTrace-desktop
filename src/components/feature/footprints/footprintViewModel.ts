import type { FootprintEntry } from "./types";

export type FootprintTimelineGroup = {
  year: string;
  entries: FootprintEntry[];
};

export function footprintDisplayPlace(
  entry: Pick<FootprintEntry, "provinceName" | "cityName" | "placeName">,
): string {
  return [entry.provinceName, entry.cityName, entry.placeName]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(" · ");
}

export function footprintDateLabel(
  entry: Pick<FootprintEntry, "startedAt" | "endedAt">,
): string {
  const start = entry.startedAt.slice(0, 10);
  const end = entry.endedAt?.slice(0, 10);
  return end && end !== start ? `${start} — ${end}` : start;
}

export function groupFootprintsByYear(entries: FootprintEntry[]): FootprintTimelineGroup[] {
  const groups = new Map<string, FootprintEntry[]>();
  for (const entry of [...entries].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const year = /^\d{4}/.test(entry.startedAt) ? entry.startedAt.slice(0, 4) : "未知";
    groups.set(year, [...(groups.get(year) ?? []), entry]);
  }
  return [...groups.entries()].map(([year, values]) => ({ year, entries: values }));
}

export function footprintVisitIntensity(visitCount: number, maximum: number): number {
  if (visitCount <= 0 || maximum <= 0) return 0;
  return Math.max(0.25, Math.min(1, visitCount / maximum));
}

export function filterFootprints(entries: FootprintEntry[], query: string): FootprintEntry[] {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return entries;
  return entries.filter((entry) =>
    [
      entry.title,
      entry.description,
      entry.provinceName,
      entry.cityName,
      entry.districtName,
      entry.placeName,
    ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(keyword)),
  );
}
