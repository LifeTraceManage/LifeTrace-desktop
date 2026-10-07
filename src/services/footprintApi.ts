import { localJsonRequest } from "@/src/services/localJsonTransport";
import type {
  FootprintEntry,
  FootprintEntryDetail,
  FootprintEntryInput,
  FootprintPhoto,
  FootprintPhotoPage,
  FootprintPhotoSuggestion,
  FootprintSummary,
  ProvinceFootprintDetail,
  ProvinceFootprintSummary,
} from "@/src/components/feature/footprints/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return localJsonRequest<T>(url, init, "足迹服务暂时不可用");
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const footprintMediaUrl = (
  photoId: string,
  kind: "thumbnail" | "original" = "thumbnail",
) => `http://127.0.0.1:3444/photo-sync/media/${encodeURIComponent(photoId)}/${kind}`;

export const footprintApi = {
  summary: () => request<FootprintSummary>("/api/footprints/summary"),
  provinces: () => request<ProvinceFootprintSummary[]>("/api/footprints/provinces"),
  province: (code: string) =>
    request<ProvinceFootprintDetail>(`/api/footprints/provinces/${encodeURIComponent(code)}`),
  entries: (options: { q?: string; provinceCode?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.q?.trim()) query.set("q", options.q.trim());
    if (options.provinceCode) query.set("provinceCode", options.provinceCode);
    const suffix = query.size ? `?${query.toString()}` : "";
    return request<FootprintEntry[]>(`/api/footprints/entries${suffix}`);
  },
  entry: (id: string) =>
    request<FootprintEntryDetail>(`/api/footprints/entries/${encodeURIComponent(id)}`),
  create: (input: FootprintEntryInput) =>
    request<FootprintEntryDetail>("/api/footprints/entries", json("POST", input)),
  update: (id: string, input: FootprintEntryInput) =>
    request<FootprintEntryDetail>(
      `/api/footprints/entries/${encodeURIComponent(id)}`,
      json("PUT", input),
    ),
  remove: (id: string) =>
    request<{ ok: true }>(
      `/api/footprints/entries/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  photos: (page = 1, pageSize = 60, q = "") => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q.trim()) query.set("q", q.trim());
    return request<FootprintPhotoPage>(`/api/footprints/photos?${query.toString()}`);
  },
  attachPhotos: (id: string, photoIds: string[]) =>
    request<FootprintPhoto[]>(
      `/api/footprints/entries/${encodeURIComponent(id)}/photos`,
      json("POST", { photoIds }),
    ),
  detachPhoto: (id: string, photoId: string) =>
    request<{ ok: true }>(
      `/api/footprints/entries/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
      { method: "DELETE" },
    ),
  photoSuggestions: (entryId: string) =>
    request<FootprintPhotoSuggestion[]>(
      `/api/footprints/photo-suggestions?entryId=${encodeURIComponent(entryId)}`,
    ),
};
