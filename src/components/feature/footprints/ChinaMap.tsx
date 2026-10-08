"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ChevronLeft, Minus, Plus, RotateCcw } from "lucide-react";
import { geoArea, geoMercator, geoPath } from "d3-geo";
import rawChina from "@/src/assets/maps/china-provinces.json";
import rawCityPoints from "@/src/assets/maps/china-city-points.json";
import type { CityFootprintSummary, ProvinceFootprintSummary } from "./types";
import { footprintVisitIntensity } from "./footprintViewModel";
import {
  clampPan,
  clientPointToViewBox,
  isDragGesture,
  zoomAtPoint,
  type MapPoint,
} from "./mapInteraction";

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

type CityPoint = {
  id: string;
  name: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  longitude: number;
  latitude: number;
};

export type FootprintMapLevel = "country" | "province";

type ChinaMapProps = {
  level: FootprintMapLevel;
  provinces: ProvinceFootprintSummary[];
  cities?: CityFootprintSummary[];
  selectedProvinceCode?: string | null;
  selectedCityCode?: string | null;
  selectedCityName?: string | null;
  onSelectProvince: (code: string, name: string) => void;
  onEnterProvince?: (code: string, name: string) => void;
  onSelectCity?: (code: string | null, name: string) => void;
  onBackToCountry?: () => void;
};

type HoveredRegion = {
  level: "province" | "city";
  code: string;
  name: string;
  visits: number;
  photoCount: number;
  cityCount?: number;
};

type DragState = {
  pointerId: number;
  startClient: MapPoint;
  startPan: MapPoint;
  moved: boolean;
};

const width = 1000;
const height = 760;
const countryMaxScale = 2.5;
const provinceMaxScale = 4.2;
const easyTapProvinceCodes = new Set([
  "110000",
  "120000",
  "310000",
  "500000",
  "810000",
  "820000",
]);

const chinaSource = rawChina as unknown as { type: string; features: AdminFeature[] };
const cityPointData = rawCityPoints as { cities: CityPoint[] };

function normalizeCityName(name: string) {
  return name
    .trim()
    .replace(/特别行政区$/, "")
    .replace(/自治州$/, "")
    .replace(/地区$/, "")
    .replace(/盟$/, "")
    .replace(/市$/, "");
}

function shortAdminName(name: string, level: "province" | "city"): string {
  const replacements = level === "province"
    ? [
        ["维吾尔自治区", ""], ["壮族自治区", ""], ["回族自治区", ""],
        ["特别行政区", ""], ["自治区", ""], ["省", ""], ["市", ""],
      ]
    : [["特别行政区", ""], ["自治州", ""], ["地区", ""], ["盟", ""], ["市", ""]];
  let result = name.trim();
  for (const [suffix, replacement] of replacements) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length) + replacement;
      break;
    }
  }
  const limit = level === "province" ? 5 : 7;
  return result.length > limit ? `${result.slice(0, limit)}…` : result;
}

function pathCenter(d: string): [number, number] {
  const values = d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [width / 2, height / 2];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function labelPoint(
  feature: AdminFeature,
  projection: (point: Position) => Position | null,
  d: string,
): [number, number] {
  const anchor = feature.properties.centroid ?? feature.properties.center;
  if (anchor) {
    const projected = projection(anchor);
    if (projected && Number.isFinite(projected[0]) && Number.isFinite(projected[1])) {
      return projected;
    }
  }
  return pathCenter(d);
}

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
  level,
  provinces,
  cities = [],
  selectedProvinceCode,
  selectedCityCode,
  selectedCityName,
  onSelectProvince,
  onEnterProvince,
  onSelectCity,
  onBackToCountry,
}: ChinaMapProps) {
  const [hovered, setHovered] = useState<HoveredRegion | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<MapPoint>({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summaryByCode = useMemo(
    () => new Map(provinces.map((province) => [province.provinceCode, province])),
    [provinces],
  );
  const citySummaryByCode = useMemo(
    () => new Map(cities.filter((city) => city.cityCode).map((city) => [String(city.cityCode), city])),
    [cities],
  );
  const citySummaryByName = useMemo(
    () => new Map(cities.map((city) => [normalizeCityName(city.cityName), city])),
    [cities],
  );

  const maxProvinceVisits = Math.max(1, ...provinces.map((province) => province.visitCount));
  const maxCityVisits = Math.max(1, ...cities.map((city) => city.visitCount));

  const provinceFeatures = useMemo(
    () => chinaSource.features
      .filter((feature) =>
        feature.geometry
        && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")
        && /^\d{6}$/.test(String(feature.properties.adcode)),
      )
      .map(fixWinding),
    [],
  );

  const countryGeometry = useMemo(() => {
    const dash = chinaSource.features.find((feature) => String(feature.properties.adcode) === "100000_JD");
    const projection = geoMercator().fitExtent(
      [[32, 24], [width - 32, height - 34]],
      featureCollection(provinceFeatures),
    );
    const path = geoPath(projection);
    return {
      paths: provinceFeatures.map((feature) => {
        const d = path(feature) ?? "";
        const center = feature.properties.centroid ?? feature.properties.center;
        const projected = center ? projection(center) : null;
        const [labelX, labelY] = labelPoint(feature, projection, d);
        return {
          code: String(feature.properties.adcode),
          name: feature.properties.name,
          d,
          x: projected?.[0] ?? null,
          y: projected?.[1] ?? null,
          labelX,
          labelY,
        };
      }),
      dashPath: dash ? path(fixWinding(dash)) ?? "" : "",
    };
  }, [provinceFeatures]);

  const provinceGeometry = useMemo(() => {
    if (!selectedProvinceCode) {
      return { outline: "", cities: [] as Array<CityPoint & { x: number; y: number }> };
    }

    const feature = provinceFeatures.find(
      (candidate) => String(candidate.properties.adcode) === selectedProvinceCode,
    );
    if (!feature) {
      return { outline: "", cities: [] as Array<CityPoint & { x: number; y: number }> };
    }

    const projection = geoMercator().fitExtent(
      [[76, 62], [width - 76, height - 72]],
      featureCollection([feature]),
    );
    const path = geoPath(projection);
    const points = cityPointData.cities
      .filter((city) => city.provinceCode === selectedProvinceCode)
      .map((city) => {
        const projected = projection([city.longitude, city.latitude]);
        return projected
          ? { ...city, x: projected[0], y: projected[1] }
          : null;
      })
      .filter((city): city is CityPoint & { x: number; y: number } => Boolean(city));

    return {
      outline: path(feature) ?? "",
      cities: points,
    };
  }, [provinceFeatures, selectedProvinceCode]);

  const citySummaryForPoint = (city: CityPoint) =>
    (city.cityCode ? citySummaryByCode.get(city.cityCode) : undefined)
    || citySummaryByName.get(normalizeCityName(city.name));

  const resetTransform = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    setHovered(null);
    resetTransform();
    dragRef.current = null;
    suppressClickRef.current = false;
    if (suppressTimerRef.current) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, [level]);

  useEffect(() => () => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
  }, []);

  const scaleAround = (nextValue: number, pointer?: MapPoint) => {
    const next = zoomAtPoint(
      { scale, pan },
      nextValue,
      pointer ?? null,
      width,
      height,
      level === "country" ? countryMaxScale : provinceMaxScale,
    );
    setScale(next.scale);
    setPan(next.pan);
  };

  const wheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = clientPointToViewBox(
      event.clientX,
      event.clientY,
      rect,
      width,
      height,
    );
    scaleAround(scale * (event.deltaY < 0 ? 1.16 : 0.86), pointer);
  };

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (scale <= 1 || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: pan,
      moved: false,
    };
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const clientPoint = { x: event.clientX, y: event.clientY };
    if (!drag.moved) {
      if (!isDragGesture(drag.startClient, clientPoint)) return;
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const deltaX = (event.clientX - drag.startClient.x) / Math.max(rect.width, 1) * width;
    const deltaY = (event.clientY - drag.startClient.y) / Math.max(rect.height, 1) * height;
    setPan(clampPan({
      x: drag.startPan.x + deltaX,
      y: drag.startPan.y + deltaY,
    }, scale, width, height));
  };

  const pointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!drag.moved) return;
    suppressClickRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
      suppressTimerRef.current = null;
    }, 0);
  };

  const allowRegionClick = () => {
    if (!suppressClickRef.current) return true;
    suppressClickRef.current = false;
    return false;
  };

  const doubleClickProvince = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (level !== "country") return;
    const target = event.target as Element | null;
    const region = target?.closest?.("[data-admin-level='province']");
    if (!region) return;

    const code = region.getAttribute("data-admin-code");
    const name = region.getAttribute("data-admin-name");
    if (!code || !name) return;

    event.preventDefault();
    event.stopPropagation();
    onEnterProvince?.(code, name);
  };

  const transformX = (1 - scale) * width / 2 + pan.x;
  const transformY = (1 - scale) * height / 2 + pan.y;
  const transform = `translate(${transformX} ${transformY}) scale(${scale})`;
  const screenPoint = (x: number, y: number) => ({
    x: transformX + x * scale,
    y: transformY + y * scale,
  });

  const provinceName = selectedProvinceCode
    ? provinces.find((province) => province.provinceCode === selectedProvinceCode)?.provinceName
      || countryGeometry.paths.find((item) => item.code === selectedProvinceCode)?.name
      || "省份"
    : "省份";

  return (
    <section className="footprint-map-card" aria-label="中国足迹地图">
      <div className="footprint-map-toolbar" aria-label="地图缩放">
        {level === "province" ? (
          <button type="button" onClick={onBackToCountry} title="返回全国" aria-label="返回全国地图">
            <ChevronLeft />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => scaleAround(scale * 1.2)}
          disabled={scale >= (level === "country" ? countryMaxScale : provinceMaxScale)}
          title="放大"
        >
          <Plus />
        </button>
        <span>{level === "country" ? "全国" : provinceName} · {Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => scaleAround(scale / 1.2)}
          disabled={scale <= 1}
          title="缩小"
        >
          <Minus />
        </button>
        <button
          type="button"
          onClick={resetTransform}
          disabled={scale === 1 && pan.x === 0 && pan.y === 0}
          title="重置当前地图视角"
        >
          <RotateCcw />
        </button>
      </div>

      <div className="footprint-map-canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={level === "country" ? "中国省级足迹地图" : `${provinceName}城市节点地图`}
          onWheel={wheel}
          onDoubleClickCapture={doubleClickProvince}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          className={scale > 1 ? "is-pannable" : ""}
        >
          <g transform={transform}>
            {level === "country" ? (
              <>
                {countryGeometry.paths.map((item) => {
                  const summary = summaryByCode.get(item.code);
                  const visited = Boolean(summary);
                  const selected = selectedProvinceCode === item.code;
                  const intensity = footprintVisitIntensity(summary?.visitCount ?? 0, maxProvinceVisits);
                  return (
                    <path
                      key={item.code}
                      d={item.d}
                      data-admin-code={item.code}
                      data-admin-name={item.name}
                      data-admin-level="province"
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
                        photoCount: summary?.photoCount ?? 0,
                        cityCount: summary?.cityCount ?? 0,
                      })}
                      onPointerLeave={() => setHovered((current) =>
                        current?.code === item.code ? null : current)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.detail > 1) return;
                        if (!allowRegionClick()) return;
                        onSelectProvince(item.code, item.name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectProvince(item.code, item.name);
                        }
                      }}
                    >
                      <title>{item.name}{visited ? ` · ${summary?.visitCount ?? 0} 次` : " · 未记录"}</title>
                    </path>
                  );
                })}
                {countryGeometry.dashPath ? (
                  <path className="footprint-map-dashline" d={countryGeometry.dashPath} />
                ) : null}
                {countryGeometry.paths
                  .filter((item) =>
                    easyTapProvinceCodes.has(item.code)
                    && item.x !== null
                    && item.y !== null)
                  .map((item) => {
                    const summary = summaryByCode.get(item.code);
                    return (
                      <circle
                        key={`${item.code}-hit-target`}
                        cx={item.x ?? undefined}
                        cy={item.y ?? undefined}
                        r={item.code === "820000" ? 24 : 19}
                        data-admin-code={item.code}
                        data-admin-name={item.name}
                        data-admin-level="province"
                        className="footprint-map-hit-target"
                        aria-hidden="true"
                        onPointerEnter={() => setHovered({
                          level: "province",
                          code: item.code,
                          name: item.name,
                          visits: summary?.visitCount ?? 0,
                          photoCount: summary?.photoCount ?? 0,
                          cityCount: summary?.cityCount ?? 0,
                        })}
                        onPointerLeave={() => setHovered((current) =>
                          current?.code === item.code ? null : current)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (event.detail > 1) return;
                          if (!allowRegionClick()) return;
                          onSelectProvince(item.code, item.name);
                        }}
                      />
                    );
                  })}
              </>
            ) : (
              <path
                d={provinceGeometry.outline}
                className="footprint-map-province-outline"
                aria-hidden="true"
              />
            )}
          </g>

          {level === "country" ? (
            <g className="footprint-map-label-layer" pointerEvents="none">
              {countryGeometry.paths.map((item) => {
                const summary = summaryByCode.get(item.code);
                const visited = Boolean(summary);
                const selected = selectedProvinceCode === item.code;
                const point = screenPoint(item.labelX, item.labelY);
                return (
                  <g
                    key={`label-${item.code}`}
                    className={[
                      "footprint-map-admin-label",
                      "province",
                      visited ? "visited" : "",
                      selected ? "selected" : "",
                    ].filter(Boolean).join(" ")}
                    transform={`translate(${point.x} ${point.y})`}
                  >
                    {visited ? <circle className="footprint-map-visit-marker" r={selected ? 7 : 5.5} /> : null}
                    <text className="footprint-map-admin-name" y={visited ? -9 : 3}>
                      {shortAdminName(item.name, "province")}
                    </text>
                    {visited ? (
                      <text className="footprint-map-visit-count" y={10}>
                        {summary?.visitCount ?? 0}次
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ) : (
            <g className="footprint-map-city-node-layer">
              {provinceGeometry.cities.map((city) => {
                const summary = citySummaryForPoint(city);
                const visited = Boolean(summary);
                const selected = selectedCityCode
                  ? Boolean(summary?.cityCode && summary.cityCode === selectedCityCode)
                    || city.cityCode === selectedCityCode
                  : Boolean(selectedCityName)
                    && normalizeCityName(selectedCityName ?? "") === normalizeCityName(city.name);
                const intensity = footprintVisitIntensity(summary?.visitCount ?? 0, maxCityVisits);
                const point = screenPoint(city.x, city.y);
                const selectCode = summary?.cityCode ?? city.cityCode;
                const selectName = summary?.cityName ?? city.name;
                return (
                  <g
                    key={city.id}
                    transform={`translate(${point.x} ${point.y})`}
                    className={[
                      "footprint-map-city-node",
                      visited ? "visited" : "",
                      selected ? "selected" : "",
                    ].filter(Boolean).join(" ")}
                    style={{ "--footprint-intensity": String(intensity) } as CSSProperties}
                    tabIndex={0}
                    role="button"
                    aria-label={visited
                      ? `${selectName}，${summary?.visitCount ?? 0} 次足迹，${summary?.photoCount ?? 0} 张照片`
                      : `${selectName}，暂无足迹`}
                    onPointerEnter={() => setHovered({
                      level: "city",
                      code: selectCode ?? city.id,
                      name: selectName,
                      visits: summary?.visitCount ?? 0,
                      photoCount: summary?.photoCount ?? 0,
                    })}
                    onPointerLeave={() => setHovered((current) =>
                      current?.code === (selectCode ?? city.id) ? null : current)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!allowRegionClick()) return;
                      onSelectCity?.(selectCode, selectName);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectCity?.(selectCode, selectName);
                      }
                    }}
                  >
                    <circle className="footprint-map-city-node-halo" r={visited ? 14 : 11} />
                    <circle className="footprint-map-city-node-dot" r={visited ? 6.5 : 4.5} />
                    <text className="footprint-map-city-node-name" y={-13}>
                      {shortAdminName(selectName, "city")}
                    </text>
                    {visited ? (
                      <text className="footprint-map-city-node-count" y={18}>
                        {summary?.visitCount ?? 0}次
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {hovered ? (
          <div className="footprint-map-tooltip" aria-live="polite">
            <strong>{hovered.name}</strong>
            <span>
              {hovered.visits
                ? `${hovered.visits} 次 · ${hovered.photoCount} 张照片`
                : "尚未记录"}
            </span>
          </div>
        ) : null}
      </div>

      <footer className="footprint-map-legend">
        <span><i className="visited" />已记录</span>
        <span><i className="unvisited" />未记录</span>
        <small>
          {level === "country"
            ? "单击省份查看详情 · 双击省份进入省内地图"
            : "省份轮廓 + 城市节点 · 单击城市筛选足迹"}
        </small>
      </footer>
    </section>
  );
}
