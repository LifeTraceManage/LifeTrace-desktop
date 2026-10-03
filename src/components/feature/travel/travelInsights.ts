import type {
  TravelPhotoLink,
  TravelPlace,
  TravelTrip,
  TravelVisit,
} from "@/src/services/travelApi";

export type TravelTimelineKind = "trip" | "visit" | "photo";

export type TravelTimelineItem = {
  id: string;
  kind: TravelTimelineKind;
  occurredAt: string;
  year: string;
  monthKey: string;
  title: string;
  subtitle?: string | null;
  tripId?: string | null;
  placeId?: string | null;
  photoLinkId?: string | null;
};

export type TravelYearStats = {
  year: string;
  trips: number;
  visits: number;
  photos: number;
};

export type TravelStats = {
  placeCount: number;
  cityCount: number;
  countryCount: number;
  tripCount: number;
  visitCount: number;
  photoCount: number;
  revisitedPlaceCount: number;
  mostVisitedPlace: { placeId: string; name: string; count: number } | null;
  yearStats: TravelYearStats[];
};

export type TravelFilterResult = {
  places: TravelPlace[];
  trips: TravelTrip[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
};

export type TravelTripSuggestion = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  visitIds: string[];
  photoLinkIds: string[];
  eventCount: number;
  locationCount: number;
  routeDistanceKm: number;
  labels: string[];
};

type TripEvidence = {
  id: string;
  kind: "visit" | "photo";
  occurredAt: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  label?: string | null;
};


function lower(value?: string | null) {
  return value?.trim().toLocaleLowerCase() || "";
}

export function travelYear(value?: string | null): string | null {
  if (!value) return null;
  const direct = value.match(/^(\d{4})/);
  if (direct) return direct[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : String(date.getFullYear());
}

export function travelMonthKey(value?: string | null): string | null {
  if (!value) return null;
  const direct = value.match(/^(\d{4})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function matchesQuery(query: string, values: Array<string | null | undefined>) {
  if (!query) return true;
  return values.some((value) => lower(value).includes(query));
}

function matchesYear(year: string, values: Array<string | null | undefined>) {
  if (year === "all") return true;
  return values.some((value) => travelYear(value) === year);
}

export function filterTravelData(input: {
  places: TravelPlace[];
  trips: TravelTrip[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
  query: string;
  year: string;
}): TravelFilterResult {
  const query = lower(input.query);
  const tripById = new Map(input.trips.map((trip) => [trip.id, trip]));
  const placeById = new Map(input.places.map((place) => [place.id, place]));
  const visitsByPlace = new Map<string, TravelVisit[]>();
  const photosByPlace = new Map<string, TravelPhotoLink[]>();

  input.visits.forEach((visit) => {
    const bucket = visitsByPlace.get(visit.placeId) ?? [];
    bucket.push(visit);
    visitsByPlace.set(visit.placeId, bucket);
  });
  input.photoLinks.forEach((photo) => {
    if (!photo.placeId) return;
    const bucket = photosByPlace.get(photo.placeId) ?? [];
    bucket.push(photo);
    photosByPlace.set(photo.placeId, bucket);
  });

  const visits = input.visits.filter((visit) => {
    const trip = visit.tripId ? tripById.get(visit.tripId) : null;
    const place = placeById.get(visit.placeId);
    return matchesQuery(query, [
      visit.placeName,
      visit.note,
      trip?.title,
      trip?.description,
      place?.city,
      place?.province,
      place?.country,
    ]) && matchesYear(input.year, [
      visit.arrivedAt,
      visit.leftAt,
      trip?.startAt,
      trip?.endAt,
    ]);
  });

  const trips = input.trips.filter((trip) => {
    const relatedVisits = input.visits.filter((visit) => visit.tripId === trip.id);
    const queryMatches = matchesQuery(query, [
      trip.title,
      trip.description,
      ...relatedVisits.map((visit) => visit.placeName),
      ...relatedVisits.map((visit) => visit.note),
    ]);
    const yearMatches = matchesYear(input.year, [
      trip.startAt,
      trip.endAt,
      ...relatedVisits.flatMap((visit) => [visit.arrivedAt, visit.leftAt]),
    ]);
    return queryMatches && yearMatches;
  });

  const photoLinks = input.photoLinks.filter((photo) => {
    const trip = photo.tripId ? tripById.get(photo.tripId) : null;
    const place = photo.placeId ? placeById.get(photo.placeId) : null;
    const queryMatches = matchesQuery(query, [
      photo.originalFileName,
      photo.placeName,
      trip?.title,
      place?.name,
      place?.city,
      place?.province,
      place?.country,
    ]);
    return queryMatches && matchesYear(input.year, [photo.capturedAt]);
  });

  const places = input.places.filter((place) => {
    const relatedVisits = visitsByPlace.get(place.id) ?? [];
    const relatedPhotos = photosByPlace.get(place.id) ?? [];
    const queryMatches = matchesQuery(query, [
      place.name,
      place.city,
      place.province,
      place.country,
      ...relatedVisits.map((visit) => visit.placeName),
      ...relatedVisits.map((visit) => visit.note),
      ...relatedVisits.map((visit) => visit.tripId ? tripById.get(visit.tripId)?.title : null),
      ...relatedPhotos.map((photo) => photo.originalFileName),
    ]);
    const yearMatches = matchesYear(input.year, [
      ...relatedVisits.flatMap((visit) => {
        const trip = visit.tripId ? tripById.get(visit.tripId) : null;
        return [visit.arrivedAt, visit.leftAt, trip?.startAt, trip?.endAt];
      }),
      ...relatedPhotos.map((photo) => photo.capturedAt),
    ]);
    return queryMatches && yearMatches;
  });

  return { places, trips, visits, photoLinks };
}

export function buildTravelTimeline(input: {
  trips: TravelTrip[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
}): TravelTimelineItem[] {
  const tripById = new Map(input.trips.map((trip) => [trip.id, trip]));
  const items: TravelTimelineItem[] = [];

  input.trips.forEach((trip) => {
    const occurredAt = trip.startAt || trip.createdAt;
    const year = travelYear(occurredAt);
    const monthKey = travelMonthKey(occurredAt);
    if (!year || !monthKey) return;
    items.push({
      id: `trip:${trip.id}`,
      kind: "trip",
      occurredAt,
      year,
      monthKey,
      title: trip.title,
      subtitle: trip.endAt ? `至 ${trip.endAt.slice(0, 10)}` : "旅行开始",
      tripId: trip.id,
    });
  });

  input.visits.forEach((visit) => {
    const occurredAt = visit.arrivedAt || visit.createdAt;
    const year = travelYear(occurredAt);
    const monthKey = travelMonthKey(occurredAt);
    if (!year || !monthKey) return;
    const trip = visit.tripId ? tripById.get(visit.tripId) : null;
    items.push({
      id: `visit:${visit.id}`,
      kind: "visit",
      occurredAt,
      year,
      monthKey,
      title: visit.placeName,
      subtitle: trip?.title || visit.note || "独立足迹",
      tripId: visit.tripId,
      placeId: visit.placeId,
    });
  });

  input.photoLinks.forEach((photo) => {
    const occurredAt = photo.capturedAt || photo.createdAt;
    const year = travelYear(occurredAt);
    const monthKey = travelMonthKey(occurredAt);
    if (!year || !monthKey) return;
    const trip = photo.tripId ? tripById.get(photo.tripId) : null;
    items.push({
      id: `photo:${photo.id}`,
      kind: "photo",
      occurredAt,
      year,
      monthKey,
      title: photo.placeName || photo.originalFileName,
      subtitle: trip?.title || "旅行照片",
      tripId: photo.tripId,
      placeId: photo.placeId,
      photoLinkId: photo.id,
    });
  });

  return items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function travelTimestamp(value: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return Date.parse(hasZone ? value : `${value}Z`);
}

function distanceKm(left: TripEvidence, right: TripEvidence) {
  const radiusKm = 6371;
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(right.latitude - left.latitude);
  const dLng = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(left.latitude))
      * Math.cos(radians(right.latitude))
      * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function suggestionTitle(events: TripEvidence[], labels: string[]) {
  const date = events[0].occurredAt.slice(0, 10);
  if (!labels.length) return `${date} 旅行`;
  if (labels.length === 1) return `${labels[0]} · ${date}`;
  if (labels.length === 2) return `${labels[0]} → ${labels[1]}`;
  return `${labels[0]} 等 ${labels.length} 地`;
}

export function buildTripSuggestions(input: {
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
}): TravelTripSuggestion[] {
  const evidence: TripEvidence[] = [];

  input.visits.forEach((visit) => {
    const occurredAt = visit.arrivedAt || visit.createdAt;
    if (
      visit.tripId
      || typeof visit.latitude !== "number"
      || typeof visit.longitude !== "number"
    ) return;
    const timestamp = travelTimestamp(occurredAt);
    if (!Number.isFinite(timestamp)) return;
    evidence.push({
      id: visit.id,
      kind: "visit",
      occurredAt,
      timestamp,
      latitude: visit.latitude,
      longitude: visit.longitude,
      label: visit.placeName,
    });
  });

  input.photoLinks.forEach((photo) => {
    const occurredAt = photo.capturedAt || photo.createdAt;
    if (
      photo.tripId
      || typeof photo.latitude !== "number"
      || typeof photo.longitude !== "number"
    ) return;
    const timestamp = travelTimestamp(occurredAt);
    if (!Number.isFinite(timestamp)) return;
    evidence.push({
      id: photo.id,
      kind: "photo",
      occurredAt,
      timestamp,
      latitude: photo.latitude,
      longitude: photo.longitude,
      label: photo.placeName,
    });
  });

  evidence.sort((left, right) => left.timestamp - right.timestamp);
  const clusters: TripEvidence[][] = [];

  evidence.forEach((event) => {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (!current || !previous) {
      clusters.push([event]);
      return;
    }
    const gapHours = Math.max(0, (event.timestamp - previous.timestamp) / 3_600_000);
    const gapDistanceKm = distanceKm(previous, event);
    const sameTrip = gapHours <= 36 || (gapHours <= 72 && gapDistanceKm <= 300);
    if (sameTrip) current.push(event);
    else clusters.push([event]);
  });

  return clusters
    .filter((events) => events.length >= 2)
    .map((events) => {
      const labels = [...new Set(
        events.map((event) => event.label?.trim()).filter((value): value is string => Boolean(value)),
      )];
      const locationKeys = new Set(events.map((event) =>
        `${event.latitude.toFixed(2)},${event.longitude.toFixed(2)}`
      ));
      const routeDistanceKm = events.slice(1).reduce(
        (total, event, index) => total + distanceKm(events[index], event),
        0,
      );
      return {
        id: `suggestion:${events[0].kind}:${events[0].id}:${events.at(-1)?.id}`,
        title: suggestionTitle(events, labels),
        startAt: events[0].occurredAt,
        endAt: events.at(-1)?.occurredAt || events[0].occurredAt,
        visitIds: events.filter((event) => event.kind === "visit").map((event) => event.id),
        photoLinkIds: events.filter((event) => event.kind === "photo").map((event) => event.id),
        eventCount: events.length,
        locationCount: locationKeys.size,
        routeDistanceKm: Math.round(routeDistanceKm),
        labels,
      };
    })
    .sort((left, right) => right.startAt.localeCompare(left.startAt))
    .slice(0, 20);
}

export function summarizeTravel(input: {
  places: TravelPlace[];
  trips: TravelTrip[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
}): TravelStats {
  const cityKeys = new Set<string>();
  const countryKeys = new Set<string>();

  input.places.forEach((place) => {
    const country = place.countryCode || place.country;
    if (country) countryKeys.add(lower(country));
    const city = place.city || (place.placeType === "city" ? place.name : null);
    if (city) cityKeys.add(`${lower(country)}|${lower(city)}`);
  });

  const visitCounts = new Map<string, number>();
  input.visits.forEach((visit) => {
    visitCounts.set(visit.placeId, (visitCounts.get(visit.placeId) ?? 0) + 1);
  });

  const mostVisitedEntry = [...visitCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0];
  const mostVisitedPlace = mostVisitedEntry
    ? {
        placeId: mostVisitedEntry[0],
        name: input.places.find((place) => place.id === mostVisitedEntry[0])?.name
          || input.visits.find((visit) => visit.placeId === mostVisitedEntry[0])?.placeName
          || "未知地点",
        count: mostVisitedEntry[1],
      }
    : null;

  const yearMap = new Map<string, TravelYearStats>();
  const ensureYear = (year: string) => {
    const existing = yearMap.get(year);
    if (existing) return existing;
    const created = { year, trips: 0, visits: 0, photos: 0 };
    yearMap.set(year, created);
    return created;
  };

  input.trips.forEach((trip) => {
    const year = travelYear(trip.startAt || trip.createdAt);
    if (year) ensureYear(year).trips += 1;
  });
  input.visits.forEach((visit) => {
    const year = travelYear(visit.arrivedAt || visit.createdAt);
    if (year) ensureYear(year).visits += 1;
  });
  input.photoLinks.forEach((photo) => {
    const year = travelYear(photo.capturedAt || photo.createdAt);
    if (year) ensureYear(year).photos += 1;
  });

  return {
    placeCount: input.places.length,
    cityCount: cityKeys.size,
    countryCount: countryKeys.size,
    tripCount: input.trips.length,
    visitCount: input.visits.length,
    photoCount: input.photoLinks.length,
    revisitedPlaceCount: [...visitCounts.values()].filter((count) => count > 1).length,
    mostVisitedPlace,
    yearStats: [...yearMap.values()].sort((left, right) => Number(right.year) - Number(left.year)),
  };
}
