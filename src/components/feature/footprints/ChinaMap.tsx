"use client";

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronLeft, Minus, Plus, RotateCcw } from "lucide-react";
import { geoArea, geoMercator, geoPath } from "d3-geo";
import rawChina from "@/src/assets/maps/china-provinces.json";
import rawPrefectures from "@/src/assets/maps/china-prefectures.json";
import type { CityFootprintSummary, ProvinceFootprintSummary } from "./types";
import { footprintVisitIntensity } from "./footprintViewModel";

type Position = [number, number];
type Ring = Position[];
type AdminFeature = {
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
  cities?: CityFootprintSummary[];
  selectedProvinceCode?: string | null;
  selectedCityCode?: string | null;
  selectedCityName?: string | null;
  onSelectProvince: (code: string, name: string) => void;
  onSelectCity?: (code: string, name: string) => void;
};

type HoveredRegion = {
  level: "province" | "city";
  code: string;
  name: string;
  visits: number;
};

const width = 1000;
const height = 760;
const countryDrillScale = 2.15;
const countryMaxScale = 2.35;
const provinceMaxScale = 4.2;

function fixWinding(feature: AdminFeature): AdminFeature {
  if (geoArea(feature) <= 2 * Math.PI) return feature;
  if (feature.geometry.type === "Polygon") {
    return {
      ...feature,
      geometry: {
        type: "Polygon",
        coordinates: (feature.geometry.coordinates as Ring[]).map((ring) => ring.slice().reverse()),
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

function featureCollection(features: AdminFeature[]) {
  return { type: "FeatureCollection" as const, features };
}

export default function ChinaMap({
  provinces,
  cities = [],
  selectedProvinceCode,
  selectedCityCode,
  selectedCityName,
  onSelectProvince,
  onSelectCity,
}: ChinaMapProps) {
  const [level, setLevel] = useState<"country" | "province">("country");
  const [hovered, setHovered] = useState<HoveredRegion | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const summaryByCode = useMemo(
    () => new Map(provinces.map((province) => [province.provinceCode, province])),
    [provinces],
  );
  const citySummaryByCode = useMemo(
    () => new Map(cities.filter((city) => city.cityCode).map((city) => [String(city.cityCode), city])),
    [cities],
  );
  const citySummaryByName = useMemo(
    () => new Map(cities.map((city) => [city.cityName, city])),
    [cities],
  );
  const maxProvinceVisits = Math.max(1, ...provinces.map((province) => province.visitCount));
  const maxCityVisits = Math.max(1, ...cities.map((city) => city.visitCount));

  const countryGeometry = useMemo(() => {
    const source = rawChina as unknown as { type: string; features: AdminFeature[] };
    const provinceFeatures = source.features
      .filter((feature) =>
        feature.geometry
        && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
        && /^\d{6}$/.test(String(feature.properties.adcode)),
      )
      .map(fixWinding);
    const dash = source.features.find((feature) => String(feature.properties.adcode) === "100000_JD");
    const projection = geoMercator().fitExtent(
      [[32, 24], [width - 32, height - 34]],
      featureCollection(provinceFeatures),
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

  const provinceGeometry = useMemo(() => {
    if (!selectedProvinceCode) return [];
    const prefix = selectedProvinceCode.slice(0, 2);
    const source = rawPrefectures as unknown as { type: string; features: AdminFeature[] };
    const features = source.features
      .filter((feature) => {
        const code = String(feature.properties.adcode);
        return /^\d{6}$/.test(code)
          && code.slice(0, 2) === prefix
          && feature.geometry
          && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon");
      })
      .map(fixWinding);
    if (!features.length) return [];
    const projection = geoMercator().fitExtent(
      [[42, 34], [width - 42, height - 42]],
      featureCollection(features),
    );
    const path = geoPath(projection);
    return features.map((feature) => ({
      code: String(feature.properties.adcode),
      name: feature.properties.name,
      d: path(feature) ?? "",
    }));
  }, [selectedProvinceCode]);

  const resetTransform = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const enterProvince = (code: string, name: string) => {
    onSelectProvince(code, name);
    setLevel("province");
    setHovered(null);
    resetTransform();
  };

  const leaveProvince = () => {
    setLevel("country");
    setHovered(null);
    resetTransform();
  };

  const scaleAround = (
    nextValue: number,
    pointer?: { x: number; y: number },
  ) => {
    const maxScale = level === "country" ? countryMaxScale : provinceMaxScale;
    const next = Math.max(1, Math.min(maxScale, nextValue));
    if (next === 1) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    if (!pointer) {
      setScale(next);
      return;
    }
    const currentTx = (1 - scale) * width / 2 + pan.x;
    const currentTy = (1 - scale) * height / 2 + pan.y;
    const worldX = (pointer.x - currentTx) / scale;
    const worldY = (pointer.y - currentTy) / scale;
    const nextTx = pointer.x - worldX * next;
    const nextTy = pointer.y - worldY * next;
    setScale(next);
    setPan({
      x: nextTx - (1 - next) * width / 2,
      y: nextTy - (1 - next) * height / 2,
    });
  };

  const wheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = {
      x: (event.clientX - rect.left) / Math.max(rect.width, 1) * width,
      y: (event.clientY - rect.top) / Math.max(rect.height, 1) * height,
    };
    const zoomingIn = event.deltaY < 0;
    const factor = zoomingIn ? 1.16 : 0.86;
    const next = scale * factor;

    if (level === "country" && zoomingIn && next >= countryDrillScale) {
      const target = hovered?.level === "province"
        ? hovered
        : selectedProvinceCode
          ? countryGeometry.paths.find((item) => item.code === selectedProvinceCode)
          : null;
      if (target) {
        enterProvince(target.code, target.name);
        return;
      }
    }

    if (level === "province" && !zoomingIn && next < 0.96) {
      leaveProvince();
      return;
    }

    scaleAround(next, pointer);
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
  const provinceName = selectedProvinceCode
    ? provinces.find((province) => province.provinceCode === selectedProvinceCode)?.provinceName
      || countryGeometry.paths.find((item) => item.code === selectedProvinceCode)?.name
      || "省份"
    : "省份";

  return (
    <section className="footprint-map-card" aria-label="中国足迹地图">
      <div className="footprint-map-toolbar" aria-label="地图缩放">
        {level === "province" ? (
          <button type="button" onClick={leaveProvince} title="返回全国">
            <ChevronLeft />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (level === "country" && scale >= countryDrillScale - 0.18) {
              const target = hovered?.level === "province"
                ? hovered
                : selectedProvinceCode
                  ? countryGeometry.paths.find((item) => item.code === selectedProvinceCode)
                  : null;
              if (target) {
                enterProvince(target.code, target.name);
                return;
              }
            }
            scaleAround(scale * 1.2);
          }}
          disabled={scale >= (level === "country" ? countryMaxScale : provinceMaxScale)}
          title="放大"
        >
          <Plus />
        </button>
        <span>{level === "country" ? "全国" : provinceName} · {Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => {
            if (level === "province" && scale <= 1.05) {
              leaveProvince();
              return;
            }
            scaleAround(scale / 1.2);
          }}
          title={level === "province" && scale <= 1.05 ? "返回全国" : "缩小"}
        >
          <Minus />
        </button>
        <button
          type="button"
          onClick={resetTransform}
          disabled={scale === 1 && pan.x === 0 && pan.y === 0}
          title="重置当前层级"
        >
          <RotateCcw />
        </button>
      </div>

      <div className="footprint-map-canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={level === "country" ? "中国省级足迹地图" : `${provinceName}市级足迹地图`}
          onWheel={wheel}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          className={scale > 1 ? "is-pannable" : ""}
        >
          <g transform={transform}>
            {level === "country" ? countryGeometry.paths.map((item) => {
              const summary = summaryByCode.get(item.code);
              const visited = Boolean(summary);
              const selected = selectedProvinceCode === item.code;
              const intensity = footprintVisitIntensity(summary?.visitCount ?? 0, maxProvinceVisits);
              return (
                <path
                  key={item.code}
                  d={item.d}
                  data-admin-code={item.code}
                  className={[
                    "footprint-map-region",
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
                  onPointerEnter={() => setHovered({
                    level: "province",
                    code: item.code,
                    name: item.name,
                    visits: summary?.visitCount ?? 0,
                  })}
                  onPointerLeave={() => setHovered((current) => current?.code === item.code ? null : current)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    enterProvince(item.code, item.name);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectProvince(item.code, item.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      enterProvince(item.code, item.name);
                    } else if (event.key === " ") {
                      event.preventDefault();
                      onSelectProvince(item.code, item.name);
                    }
                  }}
                >
                  <title>{item.name}{visited ? ` · ${summary?.visitCount ?? 0} 次` : " · 未记录"}</title>
                </path>
              );
            }) : provinceGeometry.map((item) => {
              const summary = citySummaryByCode.get(item.code) || citySummaryByName.get(item.name);
              const visited = Boolean(summary);
              const selected = selectedCityCode === item.code || (!selectedCityCode && selectedCityName === item.name);
              const intensity = footprintVisitIntensity(summary?.visitCount ?? 0, maxCityVisits);
              return (
                <path
                  key={item.code}
                  d={item.d}
                  data-admin-code={item.code}
                  className={[
                    "footprint-map-region",
                    "footprint-map-city",
                    visited ? "visited" : "",
                    selected ? "selected" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ "--footprint-intensity": String(intensity) } as CSSProperties}
                  tabIndex={0}
                  role="button"
                  aria-label={visited
                    ? `${item.name}，${summary?.visitCount ?? 0} 次足迹，${summary?.photoCount ?? 0} 张照片`
                    : `${item.name}，暂无足迹`}
                  onPointerEnter={() => setHovered({
                    level: "city",
                    code: item.code,
                    name: item.name,
                    visits: summary?.visitCount ?? 0,
                  })}
                  onPointerLeave={() => setHovered((current) => current?.code === item.code ? null : current)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectCity?.(item.code, item.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectCity?.(item.code, item.name);
                    }
                  }}
                >
                  <title>{item.name}{visited ? ` · ${summary?.visitCount ?? 0} 次` : " · 未记录"}</title>
                </path>
              );
            })}
            {level === "country" && countryGeometry.dashPath
              ? <path d={countryGeometry.dashPath} className="footprint-map-dashline" pointerEvents="none" />
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
        <small>
          {level === "country"
            ? "滚轮放大；达到阈值后自动进入悬停省份 · 双击省份也可进入"
            : "当前最小行政层级：市 / 地区 · 滚轮缩小到底返回全国"}
        </small>
      </footer>
    </section>
  );
}
