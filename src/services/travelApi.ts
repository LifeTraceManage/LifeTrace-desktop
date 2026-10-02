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

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const travelApi = {
  summary: () => request<TravelSummary>("/api/travel/summary"),
  places: {
    list: () => request<TravelPlace[]>("/api/travel/places"),
    create: (input: NewTravelPlace) => request<TravelPlace>("/api/travel/places", json(input)),
  },
  trips: {
    list: () => request<TravelTrip[]>("/api/travel/trips"),
    create: (input: NewTravelTrip) => request<TravelTrip>("/api/travel/trips", json(input)),
  },
  visits: {
    list: (filters: { tripId?: string; placeId?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.tripId) params.set("tripId", filters.tripId);
      if (filters.placeId) params.set("placeId", filters.placeId);
      return request<TravelVisit[]>(`/api/travel/visits${params.size ? `?${params}` : ""}`);
    },
    create: (input: NewTravelVisit) => request<TravelVisit>("/api/travel/visits", json(input)),
  },
};
