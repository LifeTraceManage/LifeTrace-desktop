import * as maplibregl from "maplibre-gl";
import { PMTiles, Protocol, TileType } from "pmtiles";
import type { TravelOfflineMapStatus } from "@/src/services/travelApi";

type VectorLayerMetadata = {
  id?: string;
};

type ArchiveMetadata = {
  attribution?: string;
  vector_layers?: VectorLayerMetadata[] | string;
};

export type OfflineMapStyleResult = {
  style: Record<string, unknown>;
  center: [number, number];
  zoom: number;
  bounds: [[number, number], [number, number]];
  archiveName?: string;
};

let protocol: Protocol | null = null;
let protocolRegistered = false;
const archives = new Map<string, PMTiles>();

function ensureProtocol() {
  if (!protocol) protocol = new Protocol({ metadata: true });
  if (!protocolRegistered) {
    maplibregl.addProtocol("pmtiles", protocol.tile);
    protocolRegistered = true;
  }
  return protocol;
}

function normalizeVectorLayers(value: ArchiveMetadata["vector_layers"]): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return [
    ...new Set(
      parsed
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "id" in item) {
            const id = (item as VectorLayerMetadata).id;
            return typeof id === "string" ? id : "";
          }
          return "";
        })
        .filter(Boolean),
    ),
  ];
}

function vectorLayers(sourceLayers: string[]) {
  return sourceLayers.flatMap((sourceLayer, index) => {
    const opacity = 0.22 + (index % 4) * 0.05;
    return [
      {
        id: `offline-fill-${index}`,
        type: "fill",
        source: "offline-basemap",
        "source-layer": sourceLayer,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#c8d8cf",
          "fill-opacity": opacity,
          "fill-outline-color": "#93aa9d",
        },
      },
      {
        id: `offline-line-${index}`,
        type: "line",
        source: "offline-basemap",
        "source-layer": sourceLayer,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#70887b",
          "line-opacity": 0.52,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.4, 14, 1.8],
        },
      },
      {
        id: `offline-point-${index}`,
        type: "circle",
        source: "offline-basemap",
        "source-layer": sourceLayer,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#6a8175",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 14, 4],
          "circle-opacity": 0.56,
        },
      },
    ];
  });
}

export async function buildOfflinePmtilesStyle(
  status: TravelOfflineMapStatus,
): Promise<OfflineMapStyleResult> {
  if (!status.available || !status.archiveUrl) {
    throw new Error("本机没有可用的 PMTiles 离线地图");
  }

  const pmtilesProtocol = ensureProtocol();
  let archive = archives.get(status.archiveUrl);
  if (!archive) {
    archive = new PMTiles(status.archiveUrl);
    archives.set(status.archiveUrl, archive);
    pmtilesProtocol.add(archive);
  }

  const [header, metadataRaw] = await Promise.all([
    archive.getHeader(),
    archive.getMetadata(),
  ]);
  const metadata = (metadataRaw || {}) as ArchiveMetadata;
  const sourceUrl = `pmtiles://${status.archiveUrl}`;
  const attribution = metadata.attribution || "Local PMTiles";
  const center: [number, number] = [header.centerLon, header.centerLat];
  const bounds: [[number, number], [number, number]] = [
    [header.minLon, header.minLat],
    [header.maxLon, header.maxLat],
  ];

  if (header.tileType === TileType.Mvt) {
    const sourceLayers = normalizeVectorLayers(metadata.vector_layers);
    if (!sourceLayers.length) {
      throw new Error("PMTiles 缺少 vector_layers 元数据，无法自动生成离线底图样式");
    }
    return {
      style: {
        version: 8,
        sources: {
          "offline-basemap": {
            type: "vector",
            url: sourceUrl,
            attribution,
            minzoom: header.minZoom,
            maxzoom: header.maxZoom,
          },
        },
        layers: [
          {
            id: "offline-background",
            type: "background",
            paint: { "background-color": "#eef3ef" },
          },
          ...vectorLayers(sourceLayers),
        ],
      },
      center,
      zoom: Math.max(1, Math.min(header.centerZoom, header.maxZoom)),
      bounds,
      archiveName: metadataRaw && typeof metadataRaw === "object" && "name" in metadataRaw
        ? String((metadataRaw as { name?: unknown }).name || "")
        : undefined,
    };
  }

  if ([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif].includes(header.tileType)) {
    return {
      style: {
        version: 8,
        sources: {
          "offline-basemap": {
            type: "raster",
            url: sourceUrl,
            attribution,
            minzoom: header.minZoom,
            maxzoom: header.maxZoom,
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "offline-background",
            type: "background",
            paint: { "background-color": "#e8eeea" },
          },
          {
            id: "offline-raster",
            type: "raster",
            source: "offline-basemap",
            paint: { "raster-opacity": 1 },
          },
        ],
      },
      center,
      zoom: Math.max(1, Math.min(header.centerZoom, header.maxZoom)),
      bounds,
      archiveName: metadataRaw && typeof metadataRaw === "object" && "name" in metadataRaw
        ? String((metadataRaw as { name?: unknown }).name || "")
        : undefined,
    };
  }

  throw new Error(`暂不支持该 PMTiles tile type：${header.tileType}`);
}
