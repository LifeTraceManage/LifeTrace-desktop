import type { FootprintPhoto } from "./types";

export const PHOTO_PICKER_BATCH_SIZE = 48;

/** Append without dropping selections or duplicating cards across page boundaries. */
export function mergePhotoBatches(
  existing: FootprintPhoto[],
  incoming: FootprintPhoto[],
  page: number,
): FootprintPhoto[] {
  const result = page === 1 ? [] : [...existing];
  const seen = new Set(result.map((photo) => photo.id));
  for (const photo of incoming) {
    if (!seen.has(photo.id)) {
      seen.add(photo.id);
      result.push(photo);
    }
  }
  return result;
}

export function hasMorePhotoBatches(
  loaded: number,
  total: number,
  exhausted: boolean,
): boolean {
  return !exhausted && loaded < total;
}
