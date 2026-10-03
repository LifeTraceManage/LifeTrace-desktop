import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { TravelPhotoLink, TravelPlace, TravelVisit } from "@/src/services/travelApi";

type TravelMapLibreProps = {
  places: TravelPlace[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
  selectedPlaceId?: string | null;
  selectedPhotoLinkId?: string | null;
  routeTripId?: string | null;
  showPhotos?: boolean;
  onSelectPlace: (place: TravelPlace) => void;
  onSelectPhoto: (photo: TravelPhotoLink) => void;
  onCreateAt: (latitude: number, longitude: number) => void;
};

const DEFAULT_MAP_STYLE =
  import.meta.env.VITE_TRAVEL_MAP_STYLE_URL || "https://demotiles.maplibre.org/style.json";

const PLACE_LAYER_IDS = [
  "travel-clusters",
  "travel-cluster-count",
  "travel-points",
  "travel-point-labels",
] as const;
const PHOTO_LAYER_IDS = [
  "travel-photo-clusters",
  "travel-photo-cluster-count",
  "travel-photo-points",
] as const;

function pointCollection(places: TravelPlace[], selectedPlaceId?: string | null) {
  return {
    type: "FeatureCollection",
    features: places
      .filter((place) => typeof place.latitude === "number" && typeof place.longitude === "number")
      .map((place) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [place.longitude, place.latitude],
        },
        properties: {
          id: place.id,
          name: place.name,
          visitCount: place.visitCount,
          photoCount: place.photoCount,
          selected: place.id === selectedPlaceId ? 1 : 0,
        },
      })),
  };
}

function photoCollection(photoLinks: TravelPhotoLink[], selectedPhotoLinkId?: string | null) {
  return {
    type: "FeatureCollection",
    features: photoLinks
      .filter((photo) => typeof photo.latitude === "number" && typeof photo.longitude === "number")
      .map((photo) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [photo.longitude, photo.latitude],
        },
        properties: {
          id: photo.id,
          photoId: photo.photoId,
          placeName: photo.placeName || "",
          selected: photo.id === selectedPhotoLinkId ? 1 : 0,
        },
      })),
  };
}

function routeFeatures(visits: TravelVisit[], routeTripId?: string | null) {
  const ordered = visits
    .filter(
      (visit) =>
        routeTripId &&
        visit.tripId === routeTripId &&
        typeof visit.latitude === "number" &&
        typeof visit.longitude === "number",
    )
    .sort((left, right) => {
      const sequenceDelta = (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
      if (sequenceDelta !== 0) return sequenceDelta;
      return String(left.arrivedAt ?? left.createdAt).localeCompare(String(right.arrivedAt ?? right.createdAt));
    });

  const coordinates = ordered.map((visit) => [visit.longitude as number, visit.latitude as number]);
  const line = coordinates.length >= 2
    ? {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {},
      }
    : null;

  const stops = ordered.map((visit, index) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [visit.longitude as number, visit.latitude as number],
    },
    properties: {
      id: visit.id,
      label: String(index + 1),
      name: visit.placeName,
    },
  }));

  return {
    line: {
      type: "FeatureCollection",
      features: line ? [line] : [],
    },
    stops: {
      type: "FeatureCollection",
      features: stops,
    },
    coordinates,
  };
}

function ensureTravelLayers(map: any) {
  if (!map.getSource("travel-places")) {
    map.addSource("travel-places", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 42,
      clusterMaxZoom: 13,
    });
  }
  if (!map.getLayer("travel-clusters")) {
    map.addLayer({
      id: "travel-clusters",
      type: "circle",
      source: "travel-places",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#315c49",
        "circle-radius": ["step", ["get", "point_count"], 18, 10, 23, 30, 29],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.94,
      },
    });
  }
  if (!map.getLayer("travel-cluster-count")) {
    map.addLayer({
      id: "travel-cluster-count",
      type: "symbol",
      source: "travel-places",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });
  }
  if (!map.getLayer("travel-points")) {
    map.addLayer({
      id: "travel-points",
      type: "circle",
      source: "travel-places",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 9, 7],
        "circle-color": ["case", ["==", ["get", "selected"], 1], "#d57e65", "#3f755e"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 2],
      },
    });
  }
  if (!map.getLayer("travel-point-labels")) {
    map.addLayer({
      id: "travel-point-labels",
      type: "symbol",
      source: "travel-places",
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.35],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": "#24342b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  if (!map.getSource("travel-photos")) {
    map.addSource("travel-photos", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 14,
    });
  }
  if (!map.getLayer("travel-photo-clusters")) {
    map.addLayer({
      id: "travel-photo-clusters",
      type: "circle",
      source: "travel-photos",
      filter: ["has", "point_count"],
      layout: { visibility: "none" },
      paint: {
        "circle-color": "#6b5b88",
        "circle-radius": ["step", ["get", "point_count"], 19, 10, 24, 40, 30],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.94,
      },
    });
  }
  if (!map.getLayer("travel-photo-cluster-count")) {
    map.addLayer({
      id: "travel-photo-cluster-count",
      type: "symbol",
      source: "travel-photos",
      filter: ["has", "point_count"],
      layout: {
        visibility: "none",
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });
  }
  if (!map.getLayer("travel-photo-points")) {
    map.addLayer({
      id: "travel-photo-points",
      type: "circle",
      source: "travel-photos",
      filter: ["!", ["has", "point_count"]],
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 10, 8],
        "circle-color": ["case", ["==", ["get", "selected"], 1], "#d57e65", "#776496"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 2],
      },
    });
  }

  if (!map.getSource("travel-route")) {
    map.addSource("travel-route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer("travel-route-line")) {
    map.addLayer({
      id: "travel-route-line",
      type: "line",
      source: "travel-route",
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#d57e65",
        "line-width": 4,
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getSource("travel-route-stops")) {
    map.addSource("travel-route-stops", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer("travel-route-stop-circles")) {
    map.addLayer({
      id: "travel-route-stop-circles",
      type: "circle",
      source: "travel-route-stops",
      paint: {
        "circle-radius": 10,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#d57e65",
        "circle-stroke-width": 3,
      },
    });
  }
  if (!map.getLayer("travel-route-stop-labels")) {
    map.addLayer({
      id: "travel-route-stop-labels",
      type: "symbol",
      source: "travel-route-stops",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
      },
      paint: { "text-color": "#7e4435" },
    });
  }
}

function setLayerVisibility(map: any, ids: readonly string[], visible: boolean) {
  ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  });
}

export default function TravelMapLibre({
  places,
  visits,
  photoLinks,
  selectedPlaceId,
  selectedPhotoLinkId,
  routeTripId,
  showPhotos = false,
  onSelectPlace,
  onSelectPhoto,
  onCreateAt,
}: TravelMapLibreProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const placesRef = useRef(places);
  const photosRef = useRef(photoLinks);
  const selectRef = useRef(onSelectPlace);
  const selectPhotoRef = useRef(onSelectPhoto);
  const createRef = useRef(onCreateAt);
  const [styleReady, setStyleReady] = useState(false);
  const [mapError, setMapError] = useState("");

  const route = useMemo(() => routeFeatures(visits, routeTripId), [routeTripId, visits]);

  useEffect(() => {
    placesRef.current = places;
    photosRef.current = photoLinks;
    selectRef.current = onSelectPlace;
    selectPhotoRef.current = onSelectPhoto;
    createRef.current = onCreateAt;
  }, [onCreateAt, onSelectPhoto, onSelectPlace, photoLinks, places]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_MAP_STYLE,
      center: [108.5, 34.5],
      zoom: 3.4,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      ensureTravelLayers(map);
      setStyleReady(true);
      setMapError("");
    });

    map.on("error", (event: any) => {
      const message = event?.error?.message;
      if (typeof message === "string" && message.trim()) setMapError(message);
    });

    ["travel-points", "travel-clusters", "travel-photo-points", "travel-photo-clusters"].forEach((layer) => {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    });

    map.on("click", "travel-points", (event: any) => {
      const id = event?.features?.[0]?.properties?.id;
      const place = placesRef.current.find((item) => item.id === id);
      if (place) selectRef.current(place);
    });

    map.on("click", "travel-photo-points", (event: any) => {
      const id = event?.features?.[0]?.properties?.id;
      const photo = photosRef.current.find((item) => item.id === id);
      if (photo) selectPhotoRef.current(photo);
    });

    const expandCluster = (sourceId: string) => (event: any) => {
      const feature = event?.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const coordinates = feature?.geometry?.coordinates;
      const source = map.getSource(sourceId);
      if (!source || clusterId == null || !Array.isArray(coordinates)) return;
      Promise.resolve(source.getClusterExpansionZoom(clusterId))
        .then((zoom: number) => map.easeTo({ center: coordinates, zoom }))
        .catch(() => undefined);
    };
    map.on("click", "travel-clusters", expandCluster("travel-places"));
    map.on("click", "travel-photo-clusters", expandCluster("travel-photos"));

    map.on("dblclick", (event: any) => {
      event.preventDefault();
      const lng = Number(event?.lngLat?.lng);
      const lat = Number(event?.lngLat?.lat);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        createRef.current(Number(lat.toFixed(5)), Number(lng.toFixed(5)));
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    ensureTravelLayers(map);
    map.getSource("travel-places")?.setData(pointCollection(places, selectedPlaceId));
    map.getSource("travel-photos")?.setData(photoCollection(photoLinks, selectedPhotoLinkId));
    map.getSource("travel-route")?.setData(route.line);
    map.getSource("travel-route-stops")?.setData(route.stops);
    setLayerVisibility(map, PLACE_LAYER_IDS, !showPhotos);
    setLayerVisibility(map, PHOTO_LAYER_IDS, showPhotos);

    if (showPhotos) {
      const photoPoints = photoLinks.filter(
        (photo) => typeof photo.latitude === "number" && typeof photo.longitude === "number",
      );
      if (photoPoints.length === 1) {
        map.easeTo({
          center: [photoPoints[0].longitude, photoPoints[0].latitude],
          zoom: 9,
          duration: 500,
        });
      } else if (photoPoints.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        photoPoints.forEach((photo) => bounds.extend([photo.longitude, photo.latitude]));
        map.fitBounds(bounds, { padding: 72, maxZoom: 10, duration: 600 });
      }
      return;
    }

    if (routeTripId && route.coordinates.length) {
      const bounds = new maplibregl.LngLatBounds();
      route.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: 76, maxZoom: 11, duration: 650 });
      return;
    }

    const points = places.filter(
      (place) => typeof place.latitude === "number" && typeof place.longitude === "number",
    );
    if (points.length === 1) {
      map.easeTo({
        center: [points[0].longitude, points[0].latitude],
        zoom: 8,
        duration: 500,
      });
    } else if (points.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      points.forEach((place) => bounds.extend([place.longitude, place.latitude]));
      map.fitBounds(bounds, { padding: 72, maxZoom: 8, duration: 600 });
    }
  }, [
    photoLinks,
    places,
    route,
    routeTripId,
    selectedPhotoLinkId,
    selectedPlaceId,
    showPhotos,
    styleReady,
  ]);

  return (
    <div className="lt-travel-maplibre-shell">
      <div ref={containerRef} className="lt-travel-maplibre" />
      <div className="lt-travel-map-hint">
        {showPhotos ? "照片按关联地点显示 · 点击照片点查看预览" : "双击地图添加地点 · 支持缩放、聚合与旅行路线"}
      </div>
      {mapError ? (
        <div className="lt-travel-map-warning">
          地图底图加载异常；足迹数据仍保存在本机。可通过 VITE_TRAVEL_MAP_STYLE_URL 切换地图服务。
        </div>
      ) : null}
    </div>
  );
}
