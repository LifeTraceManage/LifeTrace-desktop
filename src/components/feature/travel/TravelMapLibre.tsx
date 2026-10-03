import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { buildOfflinePmtilesStyle } from "@/src/components/feature/travel/offlinePmtiles";
import type {
  TravelOfflineMapStatus,
  TravelPhotoLink,
  TravelPlace,
  TravelVisit,
} from "@/src/services/travelApi";

type TravelMapLibreProps = {
  places: TravelPlace[];
  visits: TravelVisit[];
  photoLinks: TravelPhotoLink[];
  selectedPlaceId?: string | null;
  selectedPhotoLinkId?: string | null;
  routeTripId?: string | null;
  routeCoordinates?: [number, number][] | null;
  offlineMapStatus?: TravelOfflineMapStatus | null;
  showPhotos?: boolean;
  onSelectPlace: (place: TravelPlace) => void;
  onSelectPhoto: (photo: TravelPhotoLink) => void;
  onCreateAt: (latitude: number, longitude: number) => void;
};

const DEFAULT_MAP_STYLE =
  import.meta.env.VITE_TRAVEL_MAP_STYLE_URL || "https://demotiles.maplibre.org/style.json";

const PHOTO_THUMBNAIL_ZOOM = 10;
const MAX_VISIBLE_PHOTO_MARKERS = 60;

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

function routeFeatures(
  visits: TravelVisit[],
  routeTripId?: string | null,
  routedCoordinates?: [number, number][] | null,
) {
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

  const stopCoordinates = ordered.map(
    (visit) => [visit.longitude as number, visit.latitude as number] as [number, number],
  );
  const coordinates = routedCoordinates && routedCoordinates.length >= 2
    ? routedCoordinates
    : stopCoordinates;
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
    stopCoordinates,
  };
}

function ensureTravelLayers(map: any, includeTextLayers = true) {
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
  if (includeTextLayers && !map.getLayer("travel-cluster-count")) {
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
  if (includeTextLayers && !map.getLayer("travel-point-labels")) {
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
      clusterMaxZoom: PHOTO_THUMBNAIL_ZOOM - 1,
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
  if (includeTextLayers && !map.getLayer("travel-photo-cluster-count")) {
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
  if (includeTextLayers && !map.getLayer("travel-route-stop-labels")) {
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
  routeCoordinates,
  offlineMapStatus,
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
  const showPhotosRef = useRef(showPhotos);
  const selectedPhotoIdRef = useRef(selectedPhotoLinkId);
  const photoMarkersRef = useRef<Map<string, { marker: any; element: HTMLButtonElement }>>(new Map());
  const syncPhotoMarkersRef = useRef<(() => void) | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [offlineActive, setOfflineActive] = useState(false);
  const [mapConfig, setMapConfig] = useState<{
    style: unknown;
    center: [number, number];
    zoom: number;
    offline: boolean;
  } | null>(null);

  const route = useMemo(
    () => routeFeatures(visits, routeTripId, routeCoordinates),
    [routeCoordinates, routeTripId, visits],
  );

  useEffect(() => {
    placesRef.current = places;
    photosRef.current = photoLinks;
    selectRef.current = onSelectPlace;
    selectPhotoRef.current = onSelectPhoto;
    createRef.current = onCreateAt;
    showPhotosRef.current = showPhotos;
    selectedPhotoIdRef.current = selectedPhotoLinkId;
    syncPhotoMarkersRef.current?.();
  }, [
    onCreateAt,
    onSelectPhoto,
    onSelectPlace,
    photoLinks,
    places,
    selectedPhotoLinkId,
    showPhotos,
  ]);

  useEffect(() => {
    let cancelled = false;
    setMapConfig(null);
    setStyleReady(false);
    setOfflineActive(false);

    const resolveStyle = async () => {
      if (offlineMapStatus?.available && offlineMapStatus.archiveUrl) {
        try {
          const offline = await buildOfflinePmtilesStyle(offlineMapStatus);
          if (cancelled) return;
          setMapConfig({
            style: offline.style,
            center: offline.center,
            zoom: offline.zoom,
            offline: true,
          });
          setOfflineActive(true);
          setMapError("");
          return;
        } catch (error) {
          if (!cancelled) {
            setMapError(
              error instanceof Error
                ? `离线地图加载失败：${error.message}；已回退在线底图。`
                : "离线地图加载失败；已回退在线底图。",
            );
          }
        }
      }
      if (!cancelled) {
        setMapConfig({
          style: DEFAULT_MAP_STYLE,
          center: [108.5, 34.5],
          zoom: 3.4,
          offline: false,
        });
      }
    };

    void resolveStyle();
    return () => {
      cancelled = true;
    };
  }, [
    offlineMapStatus?.archiveUrl,
    offlineMapStatus?.available,
    offlineMapStatus?.modifiedAtMillis,
    offlineMapStatus?.sizeBytes,
  ]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapConfig) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapConfig.style,
      center: mapConfig.center,
      zoom: mapConfig.zoom,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    const clearPhotoMarkers = () => {
      photoMarkersRef.current.forEach(({ marker }) => marker.remove());
      photoMarkersRef.current.clear();
    };

    const syncPhotoMarkers = () => {
      if (!map.getLayer("travel-photo-points")) return;
      const show = showPhotosRef.current;
      const highZoom = map.getZoom() >= PHOTO_THUMBNAIL_ZOOM;
      if (!show || !highZoom) {
        clearPhotoMarkers();
        map.setLayoutProperty(
          "travel-photo-points",
          "visibility",
          show ? "visible" : "none",
        );
        return;
      }

      const bounds = map.getBounds();
      const visiblePhotos = photosRef.current.filter((photo) =>
        typeof photo.latitude === "number"
        && typeof photo.longitude === "number"
        && bounds.contains([photo.longitude, photo.latitude])
      );

      if (visiblePhotos.length === 0 || visiblePhotos.length > MAX_VISIBLE_PHOTO_MARKERS) {
        clearPhotoMarkers();
        map.setLayoutProperty("travel-photo-points", "visibility", "visible");
        return;
      }

      map.setLayoutProperty("travel-photo-points", "visibility", "none");
      const visibleIds = new Set(visiblePhotos.map((photo) => photo.id));

      photoMarkersRef.current.forEach(({ marker }, id) => {
        if (!visibleIds.has(id)) {
          marker.remove();
          photoMarkersRef.current.delete(id);
        }
      });

      visiblePhotos.forEach((photo) => {
        const existing = photoMarkersRef.current.get(photo.id);
        if (existing) {
          existing.marker.setLngLat([photo.longitude, photo.latitude]);
          existing.element.classList.toggle(
            "active",
            photo.id === selectedPhotoIdRef.current,
          );
          return;
        }

        const element = document.createElement("button");
        element.type = "button";
        element.className = "lt-travel-photo-marker";
        element.setAttribute(
          "aria-label",
          photo.placeName
            ? `查看 ${photo.placeName} 的照片`
            : `查看照片 ${photo.originalFileName}`,
        );
        element.classList.toggle("active", photo.id === selectedPhotoIdRef.current);

        const image = document.createElement("img");
        image.src = photo.thumbnailUrl;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => {
          element.classList.add("image-error");
        });
        element.appendChild(image);

        const pointer = document.createElement("span");
        pointer.className = "lt-travel-photo-marker-pointer";
        element.appendChild(pointer);

        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const current = photosRef.current.find((item) => item.id === photo.id);
          if (current) selectPhotoRef.current(current);
        });

        const marker = new maplibregl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat([photo.longitude, photo.latitude])
          .addTo(map);

        photoMarkersRef.current.set(photo.id, { marker, element });
      });
    };
    syncPhotoMarkersRef.current = syncPhotoMarkers;

    map.on("load", () => {
      ensureTravelLayers(map, !mapConfig.offline);
      syncPhotoMarkers();
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
    map.on("moveend", syncPhotoMarkers);
    map.on("zoomend", syncPhotoMarkers);

    map.on("dblclick", (event: any) => {
      event.preventDefault();
      const lng = Number(event?.lngLat?.lng);
      const lat = Number(event?.lngLat?.lat);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        createRef.current(Number(lat.toFixed(5)), Number(lng.toFixed(5)));
      }
    });

    return () => {
      syncPhotoMarkersRef.current = null;
      clearPhotoMarkers();
      map.remove();
      mapRef.current = null;
    };
  }, [mapConfig]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    ensureTravelLayers(map, !mapConfig?.offline);
    map.getSource("travel-places")?.setData(pointCollection(places, selectedPlaceId));
    map.getSource("travel-photos")?.setData(photoCollection(photoLinks, selectedPhotoLinkId));
    map.getSource("travel-route")?.setData(route.line);
    map.getSource("travel-route-stops")?.setData(route.stops);
    setLayerVisibility(map, PLACE_LAYER_IDS, !showPhotos);
    setLayerVisibility(map, PHOTO_LAYER_IDS, showPhotos);
    syncPhotoMarkersRef.current?.();

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
    mapConfig,
  ]);

  return (
    <div className="lt-travel-maplibre-shell">
      <div ref={containerRef} className="lt-travel-maplibre" />
      <div className="lt-travel-map-hint">
        {offlineActive ? <strong>离线 PMTiles · </strong> : null}
        {showPhotos
          ? `照片地图 · 放大到街区级显示缩略图 · 同屏最多 ${MAX_VISIBLE_PHOTO_MARKERS} 张`
          : "双击地图添加地点 · 支持缩放、聚合与旅行路线"}
      </div>
      {mapError ? (
        <div className="lt-travel-map-warning">
          {mapError}
        </div>
      ) : null}
    </div>
  );
}
