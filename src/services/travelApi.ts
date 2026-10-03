import { instrumentedFetch } from "@/src/services/clientObservability";

export type TravelPlaceType =
  | "country" | "city" | "attraction" | "restaurant"
  | "hotel" | "station" | "airport" | "custom";

export type TravelPlace = {
  id: string;
  name: string;
  country?: string | null;
  countryCode?: string | null;
  province?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeType: TravelPlaceType;
  visitCount: number;
  photoCount: number;
  latestVisitAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TravelTrip = {
  id: string;
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  description?: string | null;
  coverPhotoId?: string | null;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TravelVisit = {
  id: string;
  tripId?: string | null;
  placeId: string;
  placeName: string;
  latitude?: number | null;
  longitude?: number | null;
  arrivedAt?: string | null;
  leftAt?: string | null;
  note?: string | null;
  sequence?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type TravelSummary = {
  placeCount: number;
  visitCount: number;
  tripCount: number;
  photoCount: number;
  cityCount: number;
};

export type TravelReverseGeocode = {
  name?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  countryCode?: string | null;
  displayName?: string | null;
  attribution: string;
};

export type TravelRoadRoute = {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
};

export type NewTravelPlace = {
  name: string;
  country?: string | null;
  countryCode?: string | null;
  province?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeType?: TravelPlaceType;
};

export type NewTravelVisit = {
  tripId?: string | null;
  placeId: string;
  arrivedAt?: string | null;
  leftAt?: string | null;
  note?: string | null;
  sequence?: number | null;
};

export type NewTravelTrip = {
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  description?: string | null;
  coverPhotoId?: string | null;
};

export type TravelTripSuggestionAcceptance = {
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  visitIds: string[];
  photoLinkIds: string[];
};

export type TravelPhotoCandidate = {
  photoId: string;
  originalFileName: string;
  mediaType: string;
  capturedAt?: string | null;
  importedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  thumbnailUrl: string;
};

export type TravelPhotoLink = {
  id: string;
  photoId: string;
  originalFileName: string;
  mediaType: string;
  thumbnailUrl: string;
  tripId?: string | null;
  visitId?: string | null;
  placeId?: string | null;
  placeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTravelPhotoLink = {
  photoId: string;
  tripId?: string | null;
  visitId?: string | null;
  placeId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
};

type ApiError = { error?: string; code?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const response = await instrumentedFetch(globalThis.fetch, url, init, {
    module: "travel",
    action: `${method} ${url.split("?", 1)[0]}`,
    userMessage: "旅行足迹请求失败",
  });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) as T & ApiError : null;
  if (!response.ok) throw new Error((payload as ApiError | null)?.error || `旅行足迹请求失败（${response.status}）`);
  return payload as T;
}

function json(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const travelApi = {
  summary: () => request<TravelSummary>("/api/travel/summary"),
  reverseGeocode: (latitude: number, longitude: number) => {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });
    return request<TravelReverseGeocode>(`/api/travel/reverse-geocode?${params}`);
  },
  routeRoad: (
    coordinates: Array<{ latitude: number; longitude: number }>,
    profile = "driving",
  ) => request<TravelRoadRoute>(
    "/api/travel/route",
    json({ coordinates, profile }),
  ),
  places: {
    list: () => request<TravelPlace[]>("/api/travel/places"),
    create: (input: NewTravelPlace) => request<TravelPlace>("/api/travel/places", json(input)),
    update: (id: string, input: NewTravelPlace) =>
      request<TravelPlace>(`/api/travel/places/${encodeURIComponent(id)}`, json(input, "PUT")),
    remove: (id: string) =>
      request<void>(`/api/travel/places/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  trips: {
    list: () => request<TravelTrip[]>("/api/travel/trips"),
    create: (input: NewTravelTrip) => request<TravelTrip>("/api/travel/trips", json(input)),
    acceptSuggestion: (input: TravelTripSuggestionAcceptance) =>
      request<TravelTrip>("/api/travel/trips/from-suggestion", json(input)),
    update: (id: string, input: NewTravelTrip) =>
      request<TravelTrip>(`/api/travel/trips/${encodeURIComponent(id)}`, json(input, "PUT")),
    remove: (id: string) =>
      request<void>(`/api/travel/trips/${encodeURIComponent(id)}`, { method: "DELETE" }),
    reorder: (id: string, visitIds: string[]) =>
      request<TravelVisit[]>(`/api/travel/trips/${encodeURIComponent(id)}/reorder`, json({ visitIds }, "PUT")),
  },
  visits: {
    list: (filters: { tripId?: string; placeId?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.tripId) params.set("tripId", filters.tripId);
      if (filters.placeId) params.set("placeId", filters.placeId);
      return request<TravelVisit[]>(`/api/travel/visits${params.size ? `?${params}` : ""}`);
    },
    create: (input: NewTravelVisit) => request<TravelVisit>("/api/travel/visits", json(input)),
    update: (id: string, input: NewTravelVisit) =>
      request<TravelVisit>(`/api/travel/visits/${encodeURIComponent(id)}`, json(input, "PUT")),
    remove: (id: string) =>
      request<void>(`/api/travel/visits/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  photoCandidates: {
    list: (limit = 120) => request<TravelPhotoCandidate[]>(`/api/travel/photo-candidates?limit=${limit}`),
  },
  photoLinks: {
    list: () => request<TravelPhotoLink[]>("/api/travel/photo-links"),
    create: (input: NewTravelPhotoLink) =>
      request<TravelPhotoLink>("/api/travel/photo-links", json(input)),
    assignPlace: (id: string, placeId: string) =>
      request<TravelPhotoLink>(
        `/api/travel/photo-links/${encodeURIComponent(id)}/place`,
        json({ placeId }, "PUT"),
      ),
    remove: (id: string) =>
      request<void>(`/api/travel/photo-links/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
};
