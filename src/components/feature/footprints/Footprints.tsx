"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarRange,
  Map,
  MapPinned,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { footprintApi } from "@/src/services/footprintApi";
import type {
  FootprintEntry,
  FootprintEntryDetail as EntryDetail,
  FootprintMode,
  FootprintSummary as Summary,
  ProvinceFootprintDetail,
  ProvinceFootprintSummary,
} from "./types";
import { filterFootprints } from "./footprintViewModel";
import ChinaMap, { type FootprintMapLevel } from "./ChinaMap";
import FootprintEditor from "./FootprintEditor";
import FootprintEntryDetail from "./FootprintEntryDetail";
import FootprintSummary from "./FootprintSummary";
import FootprintTimelineView from "./FootprintTimelineView";
import ProvinceDrawer from "./ProvinceDrawer";

const emptySummary: Summary = {
  provinceCount: 0,
  cityCount: 0,
  entryCount: 0,
  photoCount: 0,
  favoriteCount: 0,
  firstVisitedAt: null,
  lastVisitedAt: null,
};

export default function Footprints() {
  const [mode, setMode] = useState<FootprintMode>("map");
  const [mapLevel, setMapLevel] = useState<FootprintMapLevel>("country");
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [provinces, setProvinces] = useState<ProvinceFootprintSummary[]>([]);
  const [entries, setEntries] = useState<FootprintEntry[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<{
    code: string;
    name: string;
  } | null>(null);
  const [provinceDetail, setProvinceDetail] =
    useState<ProvinceFootprintDetail | null>(null);
  const [selectedCity, setSelectedCity] = useState<{
    code: string | null;
    name: string;
  } | null>(null);
  const [provinceLoading, setProvinceLoading] = useState(false);
  const provinceRequestRef = useRef(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    entry: FootprintEntry | null;
    photoIds: string[];
  } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

  const load = useCallback(async (province = selectedProvince) => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextProvinces, nextEntries] = await Promise.all([
        footprintApi.summary(),
        footprintApi.provinces(),
        footprintApi.entries(),
      ]);
      setSummary(nextSummary);
      setProvinces(nextProvinces);
      setEntries(nextEntries);
      if (province) {
        const requestId = provinceRequestRef.current + 1;
        provinceRequestRef.current = requestId;
        const detail = await footprintApi.province(province.code);
        if (provinceRequestRef.current === requestId) {
          setProvinceDetail(detail);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "足迹加载失败");
    } finally {
      setLoading(false);
    }
  }, [selectedProvince]);

  useEffect(() => {
    void load(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseProvince = async (code: string, name: string) => {
    const requestId = provinceRequestRef.current + 1;
    provinceRequestRef.current = requestId;

    setSelectedProvince({ code, name });
    setSelectedCity(null);
    setProvinceDetail(null);
    setProvinceLoading(true);
    setError("");

    try {
      const detail = await footprintApi.province(code);
      if (provinceRequestRef.current !== requestId) return;
      setProvinceDetail(detail);
    } catch (cause) {
      if (provinceRequestRef.current !== requestId) return;
      setError(cause instanceof Error ? cause.message : "省份足迹读取失败");
    } finally {
      if (provinceRequestRef.current === requestId) {
        setProvinceLoading(false);
      }
    }
  };

  const enterProvinceMap = () => {
    if (!selectedProvince) return;
    setSelectedCity(null);
    setMapLevel("province");
  };

  const backToCountryMap = () => {
    provinceRequestRef.current += 1;
    setSelectedCity(null);
    setSelectedProvince(null);
    setProvinceDetail(null);
    setProvinceLoading(false);
    setMapLevel("country");
  };

  const enterProvinceByCode = (code: string, name: string) => {
    if (selectedProvince?.code !== code) {
      void chooseProvince(code, name);
    }
    setSelectedCity(null);
    setMapLevel("province");
  };

  const filtered = useMemo(
    () => filterFootprints(entries, query),
    [entries, query],
  );
  const selectedSummary = selectedProvince
    ? provinces.find((province) =>
      province.provinceCode === selectedProvince.code) ?? null
    : null;

  const saved = async () => {
    setEditor(null);
    await load();
    setDetailRefreshToken((value) => value + 1);
  };

  const editDetail = (detail: EntryDetail) => {
    setDetailId(null);
    setEditor({
      entry: detail.entry,
      photoIds: detail.photos.map((photo) => photo.id),
    });
  };

  return (
    <div className="footprints">
      <FootprintSummary value={summary} />

      <section className="footprint-controls">
        <div className="footprint-mode-switch" role="tablist" aria-label="足迹视图">
          <button
            type="button"
            className={mode === "map" ? "active" : ""}
            onClick={() => setMode("map")}
          >
            <Map />地图
          </button>
          <button
            type="button"
            className={mode === "timeline" ? "active" : ""}
            onClick={() => setMode("timeline")}
          >
            <CalendarRange />时间线
          </button>
        </div>
        <label className="footprint-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索地点或标题"
          />
        </label>
        <button
          className="footprint-refresh"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "spin" : ""} />刷新
        </button>
        <button
          className="footprint-add hx-btn primary"
          type="button"
          onClick={() => setEditor({ entry: null, photoIds: [] })}
        >
          <Plus />添加足迹
        </button>
      </section>

      {error ? <div className="footprint-error" role="alert">{error}</div> : null}

      {mode === "map" ? (
        <section className="footprint-map-layout">
          <ChinaMap
            level={mapLevel}
            provinces={provinces}
            cities={provinceDetail?.cities ?? []}
            selectedProvinceCode={selectedProvince?.code}
            selectedCityCode={selectedCity?.code}
            selectedCityName={selectedCity?.name}
            onSelectProvince={(code, name) => void chooseProvince(code, name)}
            onEnterProvince={enterProvinceByCode}
            onSelectCity={(code, name) => setSelectedCity({ code, name })}
            onBackToCountry={backToCountryMap}
          />
          <ProvinceDrawer
            mapLevel={mapLevel}
            selected={Boolean(selectedProvince)}
            summary={selectedSummary}
            name={selectedProvince?.name ?? "选择一个省份"}
            detail={provinceDetail}
            loading={provinceLoading}
            selectedCityCode={selectedCity?.code}
            selectedCityName={selectedCity?.name}
            onSelectCity={(code, name) => setSelectedCity({ code, name })}
            onEnterProvinceMap={enterProvinceMap}
            onBackToCountry={backToCountryMap}
            onOpenEntry={(entry) => setDetailId(entry.id)}
          />
        </section>
      ) : (
        <FootprintTimelineView
          entries={filtered}
          onOpen={(entry) => setDetailId(entry.id)}
        />
      )}

      {mode === "map" && query ? (
        <section className="footprint-search-results">
          <header>
            <strong>搜索结果</strong><span>{filtered.length} 条</span>
          </header>
          <div>
            {filtered.slice(0, 12).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setDetailId(entry.id)}
              >
                <MapPinned />
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.provinceName} · {entry.cityName || "未填写城市"}
                  </small>
                </span>
                <em>{entry.startedAt.slice(0, 10)}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {editor ? (
        <FootprintEditor
          entry={editor.entry}
          existingPhotoIds={editor.photoIds}
          preferredProvince={selectedProvince}
          onSaved={() => void saved()}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {detailId ? (
        <FootprintEntryDetail
          entryId={detailId}
          refreshToken={detailRefreshToken}
          onEdit={editDetail}
          onDeleted={() => {
            setDetailId(null);
            void load();
          }}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}
