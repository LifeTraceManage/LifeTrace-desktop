import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  CalendarDays,
  Camera,
  MapPinned,
  Plane,
  Plus,
  Route,
  X,
} from "lucide-react";
import {
  travelApi,
  type NewTravelPlace,
  type TravelPlace,
  type TravelSummary,
  type TravelTrip,
  type TravelVisit,
} from "@/src/services/travelApi";

const EMPTY_SUMMARY: TravelSummary = { placeCount: 0, visitCount: 0, tripCount: 0, photoCount: 0, cityCount: 0 };

type Panel = "none" | "place" | "trip" | "visit";

function shortDate(value?: string | null) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString();
}

function coords(place: TravelPlace) {
  return typeof place.latitude === "number" && typeof place.longitude === "number"
    ? { x: ((place.longitude + 180) / 360) * 1000, y: ((90 - place.latitude) / 180) * 520 }
    : null;
}

function TravelCoordinateMap({
  places,
  selectedId,
  onSelect,
  onCreateAt,
}: {
  places: TravelPlace[];
  selectedId?: string;
  onSelect: (place: TravelPlace) => void;
  onCreateAt: (latitude: number, longitude: number) => void;
}) {
  const plotted = useMemo(() => places.map((place) => ({ place, point: coords(place) })).filter((item) => item.point), [places]);

  const handleDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 1000;
    const y = ((event.clientY - box.top) / box.height) * 520;
    const longitude = Math.max(-180, Math.min(180, (x / 1000) * 360 - 180));
    const latitude = Math.max(-90, Math.min(90, 90 - (y / 520) * 180));
    onCreateAt(Number(latitude.toFixed(5)), Number(longitude.toFixed(5)));
  };

  return (
    <div className="lt-travel-map-shell">
      <svg
        className="lt-travel-map"
        viewBox="0 0 1000 520"
        role="img"
        aria-label="旅行足迹坐标地图"
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <pattern id="travel-grid" width="125" height="65" patternUnits="userSpaceOnUse">
            <path d="M125 0H0V65" fill="none" className="lt-travel-grid-line" />
          </pattern>
          <radialGradient id="travel-atmosphere" cx="50%" cy="42%" r="70%">
            <stop offset="0%" className="lt-travel-map-glow-start" />
            <stop offset="100%" className="lt-travel-map-glow-end" />
          </radialGradient>
        </defs>
        <rect width="1000" height="520" rx="24" fill="url(#travel-atmosphere)" />
        <rect width="1000" height="520" rx="24" fill="url(#travel-grid)" />
        <path d="M74 165C145 111 223 106 296 137c50 21 77 9 123 2 71-11 135 11 179 48 31 27 73 31 131 18 76-17 140 2 199 55-38 43-84 66-147 61-54-4-93 7-128 39-43 39-100 47-166 25-47-15-83-14-129 7-67 31-137 20-193-28-45-38-81-92-91-199Z" className="lt-travel-landmass" />
        <path d="M168 335c48-24 95-18 135 18 35 32 59 67 72 106-75 16-137-4-186-62-17-20-24-41-21-62Zm487-4c58-31 119-22 178 25 35 29 61 62 78 99-94 29-169 11-226-53-22-25-32-49-30-71Z" className="lt-travel-landmass secondary" />
        {[-120, -60, 0, 60, 120].map((lon) => (
          <text key={lon} x={((lon + 180) / 360) * 1000 + 8} y={507} className="lt-travel-coordinate-label">{lon}°</text>
        ))}
        {[60, 30, 0, -30, -60].map((lat) => (
          <text key={lat} x={12} y={((90 - lat) / 180) * 520 - 8} className="lt-travel-coordinate-label">{lat}°</text>
        ))}
        {plotted.map(({ place, point }) => {
          const active = place.id === selectedId;
          return (
            <g
              key={place.id}
              className={`lt-travel-marker${active ? " active" : ""}`}
              transform={`translate(${point!.x} ${point!.y})`}
              onClick={(event) => { event.stopPropagation(); onSelect(place); }}
              role="button"
              tabIndex={0}
            >
              <circle r={active ? 19 : 15} className="lt-travel-marker-halo" />
              <circle r={active ? 8 : 6} className="lt-travel-marker-dot" />
              <text x="13" y="-12" className="lt-travel-marker-label">{place.name}</text>
              {place.visitCount > 1 ? <text x="13" y="6" className="lt-travel-marker-count">去过 {place.visitCount} 次</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="lt-travel-map-hint">双击地图可按坐标新增足迹 · 下一阶段接入 MapLibre 实际底图</div>
    </div>
  );
}

export default function TravelModule() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [places, setPlaces] = useState<TravelPlace[]>([]);
  const [trips, setTrips] = useState<TravelTrip[]>([]);
  const [visits, setVisits] = useState<TravelVisit[]>([]);
  const [selected, setSelected] = useState<TravelPlace | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftPlace, setDraftPlace] = useState<NewTravelPlace>({ name: "", placeType: "custom", latitude: 24.4798, longitude: 118.0894 });
  const [tripTitle, setTripTitle] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visitTripId, setVisitTripId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextPlaces, nextTrips, nextVisits] = await Promise.all([
        travelApi.summary(), travelApi.places.list(), travelApi.trips.list(), travelApi.visits.list(),
      ]);
      setSummary(nextSummary);
      setPlaces(nextPlaces);
      setTrips(nextTrips);
      setVisits(nextVisits);
      setSelected((current) => current ? nextPlaces.find((item) => item.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "旅行足迹加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openPlaceAt = (latitude: number, longitude: number) => {
    setDraftPlace({ name: "", placeType: "custom", latitude, longitude });
    setPanel("place");
  };

  const createPlace = async () => {
    if (!draftPlace.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const created = await travelApi.places.create({
        ...draftPlace,
        name: draftPlace.name.trim(),
        city: draftPlace.city?.trim() || draftPlace.name.trim(),
      });
      await load();
      setSelected(created);
      setPanel("none");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地点保存失败");
    } finally {
      setSaving(false);
    }
  };

  const createTrip = async () => {
    if (!tripTitle.trim()) return;
    setSaving(true);
    try {
      await travelApi.trips.create({ title: tripTitle.trim() });
      setTripTitle("");
      setPanel("none");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "旅行创建失败");
    } finally {
      setSaving(false);
    }
  };

  const createVisit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await travelApi.visits.create({
        placeId: selected.id,
        tripId: visitTripId || null,
        arrivedAt: visitDate ? new Date(`${visitDate}T12:00:00`).toISOString() : null,
      });
      setPanel("none");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "访问记录创建失败");
    } finally {
      setSaving(false);
    }
  };

  const selectedVisits = selected ? visits.filter((visit) => visit.placeId === selected.id) : [];

  return (
    <section className="lt-travel">
      <header className="lt-travel-toolbar">
        <div className="lt-travel-tabs">
          <button type="button" className="active"><MapPinned />地图</button>
          <button type="button"><Plane />旅行 <span>{summary.tripCount}</span></button>
          <button type="button" disabled title="照片地图将在照片关联完成后启用"><Camera />照片地图</button>
          <button type="button" disabled title="路线视图将在 Trip 排序完成后启用"><Route />路线</button>
        </div>
        <div className="lt-travel-actions">
          <button type="button" onClick={() => { setDraftPlace({ name: "", placeType: "custom" }); setPanel("place"); }}><Plus />添加地点</button>
          <button type="button" className="primary" onClick={() => setPanel("trip")}><Plus />新建旅行</button>
        </div>
      </header>

      {error ? <div className="lt-travel-error" role="alert">{error}</div> : null}

      <div className="lt-travel-layout">
        <div className="lt-travel-canvas">
          {loading ? <div className="lt-travel-loading">正在读取本机旅行足迹…</div> : (
            <TravelCoordinateMap
              places={places}
              selectedId={selected?.id}
              onSelect={(place) => setSelected(place)}
              onCreateAt={openPlaceAt}
            />
          )}
          <div className="lt-travel-stats">
            <span><strong>{summary.cityCount}</strong><small>城市</small></span>
            <span><strong>{summary.tripCount}</strong><small>旅行</small></span>
            <span><strong>{summary.visitCount}</strong><small>访问</small></span>
            <span><strong>{summary.photoCount}</strong><small>照片</small></span>
          </div>
        </div>

        <aside className="lt-travel-detail">
          {selected ? (
            <>
              <div className="lt-travel-detail-head">
                <div><span>地点</span><h2>{selected.name}</h2><p>{[selected.city, selected.province, selected.country].filter(Boolean).join(" · ") || "尚未补充地区信息"}</p></div>
                <button type="button" aria-label="关闭地点详情" onClick={() => setSelected(null)}><X /></button>
              </div>
              <div className="lt-travel-place-metrics">
                <span><strong>{selected.visitCount}</strong><small>访问次数</small></span>
                <span><strong>{selected.photoCount}</strong><small>关联照片</small></span>
              </div>
              <button className="lt-travel-add-visit" type="button" onClick={() => setPanel("visit")}><CalendarDays />记录这次到访</button>
              <div className="lt-travel-visit-list">
                <h3>访问记录</h3>
                {selectedVisits.length ? selectedVisits.map((visit) => (
                  <article key={visit.id}>
                    <span>{shortDate(visit.arrivedAt)}</span>
                    <strong>{trips.find((trip) => trip.id === visit.tripId)?.title || "独立足迹"}</strong>
                    {visit.note ? <p>{visit.note}</p> : null}
                  </article>
                )) : <p className="empty">还没有访问记录，地点已经保存到足迹库。</p>}
              </div>
            </>
          ) : (
            <div className="lt-travel-empty-detail">
              <MapPinned />
              <h2>选择一个足迹</h2>
              <p>点击地图上的地点查看多次访问记录。双击地图也可以直接按坐标创建地点。</p>
              {places.slice(0, 5).map((place) => (
                <button type="button" key={place.id} onClick={() => setSelected(place)}>
                  <span>{place.name}</span><small>{place.visitCount ? `${place.visitCount} 次到访` : "仅保存地点"}</small>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {panel !== "none" ? (
        <div className="lt-travel-sheet-backdrop" onMouseDown={() => !saving && setPanel("none")}>
          <section className="lt-travel-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>Travel</span><h2>{panel === "place" ? "添加地点" : panel === "trip" ? "新建旅行" : "记录到访"}</h2></div><button type="button" onClick={() => setPanel("none")}><X /></button></header>
            {panel === "place" ? (
              <div className="lt-travel-form">
                <label>地点名称<input autoFocus value={draftPlace.name} onChange={(e) => setDraftPlace((v) => ({ ...v, name: e.target.value }))} placeholder="例如：鼓浪屿" /></label>
                <label>城市<input value={draftPlace.city || ""} onChange={(e) => setDraftPlace((v) => ({ ...v, city: e.target.value }))} placeholder="厦门" /></label>
                <div className="row">
                  <label>纬度<input type="number" step="0.00001" value={draftPlace.latitude ?? ""} onChange={(e) => setDraftPlace((v) => ({ ...v, latitude: e.target.value === "" ? null : Number(e.target.value) }))} /></label>
                  <label>经度<input type="number" step="0.00001" value={draftPlace.longitude ?? ""} onChange={(e) => setDraftPlace((v) => ({ ...v, longitude: e.target.value === "" ? null : Number(e.target.value) }))} /></label>
                </div>
                <button type="button" className="primary" disabled={saving || !draftPlace.name.trim()} onClick={() => void createPlace()}>{saving ? "保存中…" : "保存地点"}</button>
              </div>
            ) : panel === "trip" ? (
              <div className="lt-travel-form">
                <label>旅行名称<input autoFocus value={tripTitle} onChange={(e) => setTripTitle(e.target.value)} placeholder="例如：2026 厦门旅行" /></label>
                <button type="button" className="primary" disabled={saving || !tripTitle.trim()} onClick={() => void createTrip()}>{saving ? "创建中…" : "创建旅行"}</button>
              </div>
            ) : (
              <div className="lt-travel-form">
                <label>地点<input value={selected?.name || ""} disabled /></label>
                <label>日期<input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></label>
                <label>所属旅行<select value={visitTripId} onChange={(e) => setVisitTripId(e.target.value)}><option value="">独立足迹</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
                <button type="button" className="primary" disabled={saving || !selected} onClick={() => void createVisit()}>{saving ? "保存中…" : "保存访问记录"}</button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
