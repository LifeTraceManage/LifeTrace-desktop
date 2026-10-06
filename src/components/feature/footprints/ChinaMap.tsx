"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { geoArea, geoMercator, geoPath } from "d3-geo";
import rawChina from "@/src/assets/maps/china-provinces.json";
import type { ProvinceFootprintSummary } from "./types";
import { footprintVisitIntensity } from "./footprintViewModel";

type Position = [number, number];
type Ring = Position[];
type ProvinceFeature = {
  type: "Feature";
  properties: {
    adcode: number | string;
    name: string;
    center?: [number, number];
    centroid?: [number, number];
  };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] }
    | { type: string; coordinates: unknown };
};

type ChinaMapProps = {
  provinces: ProvinceFootprintSummary[];
  selectedProvinceCode?: string | null;
  onSelectProvince: (code: string, name: string) => void;
};

const width = 1000;
const height = 760;
const minScale = 1;
const maxScale = 2.4;

function fixWinding(feature: ProvinceFeature): ProvinceFeature {
  if (geoArea(feature) <= 2 * Math.PI) return feature;
  if (feature.geometry.type === "Polygon") {
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: (feature.geometry.coordinates as Ring[])
          .map((ring) => ring.slice().reverse()),
      },
    };
  }
  if (feature.geometry.type === "MultiPolygon") {
    return {
      ...feature,
      geometry: {
        type: "MultiPolygon",
        coordinates: (feature.geometry.coordinates as Ring[][])
          .map((polygon) => polygon.map((ring) => ring.slice().reverse())),
      },
    };
  }
  return feature;
}

export default function ChinaMap({
  provinces,
  selectedProvinceCode,
  onSelectProvince,
}: ChinaMapProps) {
  const [hovered, setHovered] = useState<{
    code: string;
    name: string;
    visits: number;
  } | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  const summaryByCode = useMemo(
    () => new Map(provinces.map((province) => [province.provinceCode, province])),
    [provinces],
  );
  const maxVisits = Math.max(1, ...provinces.map((province) => province.visitCount));

  const { paths, dashPath } = useMemo(() => {
    const source = rawChina as unknown as {
      type: string;
      features: ProvinceFeature[];
    };
    const provinceFeatures = source.features
      .filter((feature) =>
        feature.geometry
        && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
        && /^\d{6}$/.test(String(feature.properties.adcode)),
      )
      .map(fixWinding);
    const dash = source.features
      .find((feature) => String(feature.properties.adcode) === "100000_JD");
    const projection = geoMercator().fitExtent(
      [[32, 24], [width - 32, height - 34]],
      { type: "FeatureCollection", features: provinceFeatures },
    );
    const path = geoPath(projection);
    return {
      paths: provinceFeatures.map((feature) => ({
        code: String(feature.properties.adcode),
        name: feature.properties.name,
        d: path(feature) ?? "",
      })),
      dashPath: dash ? path(fixWinding(dash)) ?? "" : "",
    };
  }, []);

  const setClampedScale = (next: number) => {
    const value = Math.max(minScale, Math.min(maxScale, next));
    setScale(value);
    if (value === 1) setPan({ x: 0, y: 0 });
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + (event.clientX - drag.x) / scale,
      y: drag.panY + (event.clientY - drag.y) / scale,
    });
  };
  const pointerEnd = () => {
    dragRef.current = null;
  };

  const transform = `translate(${(1 - scale) * width / 2 + pan.x} ${(1 - scale) * height / 2 + pan.y}) scale(${scale})`;

  return (
    <section className="footprint-map-card" aria-label="中国足迹地图">
      <div className="footprint-map-toolbar" aria-label="地图缩放">
        <button
          type="button"
          onClick={() => setClampedScale(scale + 0.2)}
          disabled={scale >= maxScale}
          title="放大"
        >
          <Plus />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => setClampedScale(scale - 0.2)}
          disabled={scale <= minScale}
          title="缩小"
        >
          <Minus />
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setPan({ x: 0, y: 0 });
          }}
          disabled={scale === 1 && pan.x === 0 && pan.y === 0}
          title="重置"
        >
          <RotateCcw />
        </button>
      </div>

      <div className="footprint-map-canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="中国省级足迹地图，已去过省份高亮"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          className={scale > 1 ? "is-pannable" : ""}
        >
          <g transform={transform}>
            {paths.map((item) => {
              const summary = summaryByCode.get(item.code);
              const visited = Boolean(summary);
              const selected = selectedProvinceCode === item.code;
              const intensity = footprintVisitIntensity(
                summary?.visitCount ?? 0,
                maxVisits,
              );
              return (
                <path
                  key={item.code}
                  d={item.d}
                  className={[
                    "footprint-map-province",
                    visited ? "visited" : "",
                    selected ? "selected" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ "--footprint-intensity": String(intensity) } as CSSProperties}
                  tabIndex={0}
                  role="button"
                  aria-label={visited
                    ? `${item.name}，${summary?.visitCount ?? 0} 次足迹，${summary?.photoCount ?? 0} 张照片`
                    : `${item.name}，暂无足迹`}
                  onPointerEnter={() =>
                    setHovered({
                      code: item.code,
                      name: item.name,
                      visits: summary?.visitCount ?? 0,
                    })}
                  onPointerLeave={() =>
                    setHovered((current) =>
                      current?.code === item.code ? null : current)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectProvince(item.code, item.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectProvince(item.code, item.name);
                    }
                  }}
                >
                  <title>
                    {item.name}
                    {visited ? ` · ${summary?.visitCount ?? 0} 次` : " · 未记录"}
                  </title>
                </path>
              );
            })}
            {dashPath
              ? <path d={dashPath} className="footprint-map-dashline" pointerEvents="none" />
              : null}
          </g>
        </svg>

        {hovered ? (
          <div className="footprint-map-tooltip">
            <strong>{hovered.name}</strong>
            <span>{hovered.visits ? `${hovered.visits} 次足迹` : "尚未记录"}</span>
          </div>
        ) : null}
      </div>

      <footer className="footprint-map-legend">
        <span><i className="unvisited" />未记录</span>
        <span><i className="visited" />已去过</span>
        <small>放大后可拖动地图</small>
      </footer>
    </section>
  );
}
