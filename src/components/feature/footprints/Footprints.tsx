"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
  FootprintPhotoDiscovery,
  FootprintSummary as Summary,
  ProvinceFootprintDetail,
  ProvinceFootprintSummary,
} from "./types";
import { filterFootprints } from "./footprintViewModel";
import { resolveCoordinates } from "./footprintRegion";
import { consumeFootprintPhotoDraft } from "./footprintPhotoDraft";
import ChinaMap from "./ChinaMap";
import FootprintDiscoveries from "./FootprintDiscoveries";
import FootprintEditor, { type FootprintEditorDraft } from "./FootprintEditor";
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
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [provinces, setProvinces] = useState<ProvinceFootprintSummary[]>([]);
  const [entries, setEntries] = useState<FootprintEntry[]>([]);
  const [selectedProvince, setSelectedProvince] = useState<{
    code: string;
    name: string;
  } | null>(null);
  const [provinceDetail, setProvinceDetail] =
    useState<ProvinceFootprintDetail | null>(null);
  const [provinceLoading, setProvinceLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
    entry: FootprintEntry | null;
    photoIds: string[];
    draft?: FootprintEditorDraft | null;
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
        setProvinceDetail(await footprintApi.province(province.code));
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

  useEffect(() => {
    const photoDraft = consumeFootprintPhotoDraft();
    if (!photoDraft) return;
    setEditor({
      entry: null,
      photoIds: photoDraft.photoIds,
      draft: {
        title: "照片足迹",
        startedAt: photoDraft.startedAt,
        endedAt: photoDraft.endedAt ?? null,
      },
    });
  }, []);

  const chooseProvince = async (code: string, name: string) => {
    setSelectedProvince({ code, name });
    setProvinceLoading(true);
    try {
      setProvinceDetail(await footprintApi.province(code));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "省份足迹读取失败");
    } finally {
      setProvinceLoading(false);
    }
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
      draft: null,
    });
  };

  const createFromDiscovery = (discovery: FootprintPhotoDiscovery) => {
    const region = resolveCoordinates(discovery.latitude, discovery.longitude);
    setEditor({
      entry: null,
      photoIds: discovery.photoIds,
      draft: {
        title: region?.cityName
          ? `${region.cityName} · ${discovery.startedAt}`
          : `照片足迹 · ${discovery.startedAt}`,
        startedAt: discovery.startedAt,
        endedAt: discovery.endedAt,
        latitude: discovery.latitude,
        longitude: discovery.longitude,
        provinceCode: region?.provinceCode ?? null,
        provinceName: region?.provinceName ?? null,
        cityCode: region?.cityCode ?? null,
        cityName: region?.cityName ?? null,
      },
    });
  };

  return (
    <div className="footprints">
      <section className="footprint-hero">
        <div>
          <span className="hx-pill">本地优先 · LifeTrace Footprints</span>
          <h1>把人生经历放回地图里</h1>
          <p>
            用地点连接照片、日期和回忆。核心地图离线工作，
            GPS 不发送给第三方地图服务。
          </p>
        </div>
        <button
          className="hx-btn primary"
          type="button"
          onClick={() => setEditor({ entry: null, photoIds: [], draft: null })}
        >
          <Plus />添加足迹
        </button>
      </section>

      <FootprintSummary value={summary} />

      <FootprintDiscoveries
        refreshToken={detailRefreshToken}
        onCreate={createFromDiscovery}
      />

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
      </section>

      {error ? <div className="footprint-error" role="alert">{error}</div> : null}

      {mode === "map" ? (
        <section className="footprint-map-layout">
          <ChinaMap
            provinces={provinces}
            selectedProvinceCode={selectedProvince?.code}
            onSelectProvince={(code, name) => void chooseProvince(code, name)}
          />
          <ProvinceDrawer
            summary={selectedSummary}
            name={selectedProvince?.name ?? "选择一个省份"}
            detail={provinceDetail}
            loading={provinceLoading}
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
          draft={editor.draft}
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
