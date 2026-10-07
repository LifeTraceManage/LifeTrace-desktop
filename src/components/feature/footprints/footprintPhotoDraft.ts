"use client";

export const FOOTPRINT_PHOTO_DRAFT_KEY = "lifetrace:footprints:photo-draft";

export type FootprintPhotoDraft = {
  photoIds: string[];
  startedAt?: string;
  endedAt?: string;
};

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

export function writeFootprintPhotoDraft(draft: FootprintPhotoDraft): void {
  if (typeof window === "undefined") return;
  const photoIds = [...new Set(draft.photoIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!photoIds.length) return;
  try {
    window.sessionStorage.setItem(FOOTPRINT_PHOTO_DRAFT_KEY, JSON.stringify({
      photoIds,
      startedAt: normalizeDate(draft.startedAt),
      endedAt: normalizeDate(draft.endedAt),
    }));
  } catch {
    // A denied sessionStorage write should not break the photo library.
  }
}

export function consumeFootprintPhotoDraft(): FootprintPhotoDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FOOTPRINT_PHOTO_DRAFT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(FOOTPRINT_PHOTO_DRAFT_KEY);
    const parsed = JSON.parse(raw) as Partial<FootprintPhotoDraft>;
    const photoIds = Array.isArray(parsed.photoIds)
      ? [...new Set(parsed.photoIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
      : [];
    if (!photoIds.length) return null;
    return {
      photoIds,
      startedAt: normalizeDate(parsed.startedAt),
      endedAt: normalizeDate(parsed.endedAt),
    };
  } catch {
    window.sessionStorage.removeItem(FOOTPRINT_PHOTO_DRAFT_KEY);
    return null;
  }
}
