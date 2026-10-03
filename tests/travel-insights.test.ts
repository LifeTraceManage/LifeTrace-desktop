import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTravelTimeline,
  buildTripSuggestions,
  filterTravelData,
  summarizeTravel,
  travelMonthKey,
  travelYear,
} from "../src/components/feature/travel/travelInsights";
import type {
  TravelPhotoLink,
  TravelPlace,
  TravelTrip,
  TravelVisit,
} from "../src/services/travelApi";

const places: TravelPlace[] = [
  {
    id: "xm",
    name: "厦门",
    country: "中国",
    countryCode: "CN",
    province: "福建",
    city: "厦门",
    latitude: 24.47,
    longitude: 118.08,
    placeType: "city",
    visitCount: 2,
    photoCount: 1,
    latestVisitAt: "2026-09-28T12:00:00Z",
    createdAt: "2025-10-01T00:00:00Z",
    updatedAt: "2026-09-28T12:00:00Z",
  },
  {
    id: "hk",
    name: "香港",
    country: "中国",
    countryCode: "CN",
    city: "香港",
    latitude: 22.31,
    longitude: 114.17,
    placeType: "city",
    visitCount: 1,
    photoCount: 0,
    latestVisitAt: "2024-04-03T12:00:00Z",
    createdAt: "2024-04-03T12:00:00Z",
    updatedAt: "2024-04-03T12:00:00Z",
  },
];

const trips: TravelTrip[] = [
  {
    id: "trip-2026",
    title: "厦门周末",
    startAt: "2026-09-27T00:00:00Z",
    endAt: "2026-09-29T00:00:00Z",
    description: "海边",
    visitCount: 2,
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:00:00Z",
  },
  {
    id: "trip-2024",
    title: "香港旅行",
    startAt: "2024-04-03T00:00:00Z",
    endAt: "2024-04-04T00:00:00Z",
    visitCount: 1,
    createdAt: "2024-04-01T00:00:00Z",
    updatedAt: "2024-04-01T00:00:00Z",
  },
];

const visits: TravelVisit[] = [
  {
    id: "v1",
    tripId: "trip-2026",
    placeId: "xm",
    placeName: "厦门",
    latitude: 24.47,
    longitude: 118.08,
    arrivedAt: "2026-09-27T10:00:00Z",
    sequence: 1,
    createdAt: "2026-09-27T10:00:00Z",
    updatedAt: "2026-09-27T10:00:00Z",
  },
  {
    id: "v2",
    tripId: "trip-2026",
    placeId: "xm",
    placeName: "厦门",
    latitude: 24.47,
    longitude: 118.08,
    arrivedAt: "2026-09-28T10:00:00Z",
    sequence: 2,
    createdAt: "2026-09-28T10:00:00Z",
    updatedAt: "2026-09-28T10:00:00Z",
  },
  {
    id: "v3",
    tripId: "trip-2024",
    placeId: "hk",
    placeName: "香港",
    latitude: 22.31,
    longitude: 114.17,
    arrivedAt: "2024-04-03T10:00:00Z",
    sequence: 1,
    createdAt: "2024-04-03T10:00:00Z",
    updatedAt: "2024-04-03T10:00:00Z",
  },
];

const photoLinks: TravelPhotoLink[] = [
  {
    id: "p1",
    photoId: "photo-1",
    originalFileName: "鼓浪屿.jpg",
    mediaType: "image",
    thumbnailUrl: "thumb",
    tripId: "trip-2026",
    placeId: "xm",
    placeName: "厦门",
    latitude: 24.47,
    longitude: 118.08,
    capturedAt: "2026-09-28T18:00:00",
    createdAt: "2026-09-28T18:00:00Z",
    updatedAt: "2026-09-28T18:00:00Z",
  },
];

test("travel date helpers preserve explicit local year and month", () => {
  assert.equal(travelYear("2026-09-28T18:00:00"), "2026");
  assert.equal(travelMonthKey("2026-09-28T18:00:00"), "2026-09");
  assert.equal(travelYear("not-a-date"), null);
});

test("travel filter matches query through related trip and respects year", () => {
  const result = filterTravelData({
    places,
    trips,
    visits,
    photoLinks,
    query: "周末",
    year: "2026",
  });
  assert.deepEqual(result.places.map((place) => place.id), ["xm"]);
  assert.deepEqual(result.trips.map((trip) => trip.id), ["trip-2026"]);
  assert.equal(result.visits.length, 2);
  assert.equal(result.photoLinks.length, 1);
});

test("timeline merges trips visits and photos newest first", () => {
  const timeline = buildTravelTimeline({ trips, visits, photoLinks });
  assert.equal(timeline[0].id, "photo:p1");
  assert.equal(timeline[0].monthKey, "2026-09");
  assert.ok(timeline.some((item) => item.id === "trip:trip-2024"));
  assert.ok(timeline.some((item) => item.id === "visit:v1"));
});

test("stats count countries cities revisits and yearly activity", () => {
  const stats = summarizeTravel({ places, trips, visits, photoLinks });
  assert.equal(stats.countryCount, 1);
  assert.equal(stats.cityCount, 2);
  assert.equal(stats.revisitedPlaceCount, 1);
  assert.deepEqual(stats.mostVisitedPlace, { placeId: "xm", name: "厦门", count: 2 });
  assert.deepEqual(stats.yearStats[0], { year: "2026", trips: 1, visits: 2, photos: 1 });
});


test("trip suggestions cluster nearby-in-time unassigned GPS evidence", () => {
  const unassignedVisits: TravelVisit[] = [
    {
      ...visits[0],
      id: "auto-v1",
      tripId: null,
      arrivedAt: "2026-10-01T08:00:00",
      latitude: 24.47,
      longitude: 118.08,
      placeName: "厦门",
    },
    {
      ...visits[0],
      id: "auto-v2",
      tripId: null,
      arrivedAt: "2026-10-02T10:00:00",
      latitude: 31.23,
      longitude: 121.47,
      placeName: "上海",
    },
    {
      ...visits[0],
      id: "auto-v3",
      tripId: null,
      arrivedAt: "2026-10-08T10:00:00",
      latitude: 22.31,
      longitude: 114.17,
      placeName: "香港",
    },
  ];
  const unassignedPhotos: TravelPhotoLink[] = [{
    ...photoLinks[0],
    id: "auto-p1",
    tripId: null,
    placeId: null,
    placeName: null,
    capturedAt: "2026-10-02T18:00:00",
    latitude: 31.24,
    longitude: 121.49,
  }];

  const suggestions = buildTripSuggestions({
    visits: unassignedVisits,
    photoLinks: unassignedPhotos,
  });

  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0].visitIds, ["auto-v1", "auto-v2"]);
  assert.deepEqual(suggestions[0].photoLinkIds, ["auto-p1"]);
  assert.equal(suggestions[0].eventCount, 3);
  assert.equal(suggestions[0].locationCount, 3);
  assert.match(suggestions[0].title, /厦门/);
  assert.ok(suggestions[0].routeDistanceKm > 500);
});

test("trip suggestions ignore evidence already assigned to trips", () => {
  const suggestions = buildTripSuggestions({ visits, photoLinks });
  assert.deepEqual(suggestions, []);
});
