import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  MapPinned,
  Plane,
  Plus,
  Route,
  X,
} from "lucide-react";
import TravelMapLibre from "@/src/components/feature/travel/TravelMapLibre";
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
type TravelMode = "map" | "trips" | "route";

function shortDate(value?: string | null) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString();
}

function dateToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sortVisits(values: TravelVisit[]) {
  return [...values].sort((left, right) => {
    const sequenceDelta = (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
    if (sequenceDelta !== 0) return sequenceDelta;
    return String(left.arrivedAt ?? left.createdAt).localeCompare(String(right.arrivedAt ?? right.createdAt));
  });
}

export default function TravelModule() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [places, setPlaces] = useState<TravelPlace[]>([]);
  const [trips, setTrips] = useState<TravelTrip[]>([]);
  const [visits, setVisits] = useState<TravelVisit[]>([]);
  const [selected, setSelected] = useState<TravelPlace | null>(null);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [mode, setMode] = useState<TravelMode>("map");
  const [panel, setPanel] = useState<Panel>("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftPlace, setDraftPlace] = useState<NewTravelPlace>({
    name: "",
    placeType: "custom",
    latitude: 24.4798,
    longitude: 118.0894,
  });
  const [tripTitle, setTripTitle] = useState("");
  const [tripStartDate, setTripStartDate] = useState("");
  const [tripEndDate, setTripEndDate] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visitTripId, setVisitTripId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextPlaces, nextTrips, nextVisits] = await Promise.all([
        travelApi.summary(),
        travelApi.places.list(),
        travelApi.trips.list(),
        travelApi.visits.list(),
      ]);
      setSummary(nextSummary);
      setPlaces(nextPlaces);
      setTrips(nextTrips);
      setVisits(nextVisits);
      setSelected((current) => current ? nextPlaces.find((item) => item.id === current.id) ?? null : null);
      setSelectedTripId((current) => {
        if (current && nextTrips.some((trip) => trip.id === current)) return current;
        return nextTrips[0]?.id ?? "";
      });
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
      setMode("map");
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
    setError("");
    try {
      const created = await travelApi.trips.create({
        title: tripTitle.trim(),
        startAt: dateToIso(tripStartDate),
        endAt: dateToIso(tripEndDate),
      });
      setSelectedTripId(created.id);
      setTripTitle("");
      setTripStartDate("");
      setTripEndDate("");
      setMode("trips");
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
    setError("");
    try {
      await travelApi.visits.create({
        placeId: selected.id,
        tripId: visitTripId || null,
        arrivedAt: dateToIso(visitDate),
      });
      setPanel("none");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "访问记录创建失败");
    } finally {
      setSaving(false);
    }
  };

  const selectedVisits = useMemo(
    () => selected ? sortVisits(visits.filter((visit) => visit.placeId === selected.id)) : [],
    [selected, visits],
  );
  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips],
  );
  const selectedTripVisits = useMemo(
    () => selectedTrip ? sortVisits(visits.filter((visit) => visit.tripId === selectedTrip.id)) : [],
    [selectedTrip, visits],
  );

  const selectTrip = (trip: TravelTrip, nextMode: TravelMode = "trips") => {
    setSelectedTripId(trip.id);
    setMode(nextMode);
  };

  return (
    <section className="lt-travel">
      <header className="lt-travel-toolbar">
        <div className="lt-travel-tabs">
          <button type="button" className={mode === "map" ? "active" : ""} onClick={() => setMode("map")}>
            <MapPinned />地图
          </button>
          <button type="button" className={mode === "trips" ? "active" : ""} onClick={() => setMode("trips")}>
            <Plane />旅行 <span>{summary.tripCount}</span>
          </button>
          <button type="button" disabled title="照片地图将在照片关联完成后启用">
            <Camera />照片地图
          </button>
          <button type="button" className={mode === "route" ? "active" : ""} onClick={() => setMode("route")}>
            <Route />路线
          </button>
        </div>
        <div className="lt-travel-actions">
          <button type="button" onClick={() => {
            setDraftPlace({ name: "", placeType: "custom" });
            setPanel("place");
          }}>
            <Plus />添加地点
          </button>
          <button type="button" className="primary" onClick={() => setPanel("trip")}>
            <Plus />新建旅行
          </button>
        </div>
      </header>

      {error ? <div className="lt-travel-error" role="alert">{error}</div> : null}

      <div className="lt-travel-layout">
        <div className="lt-travel-canvas">
          {loading ? (
            <div className="lt-travel-loading">正在读取本机旅行足迹…</div>
          ) : (
            <TravelMapLibre
              places={places}
              visits={visits}
              selectedPlaceId={selected?.id}
              routeTripId={mode === "route" ? selectedTripId : null}
              onSelectPlace={(place) => {
                setSelected(place);
                setMode("map");
              }}
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
          {mode === "trips" ? (
            <div className="lt-travel-trip-panel">
              <div className="lt-travel-panel-heading">
                <div><span>Trips</span><h2>旅行</h2><p>把多次访问组织成一次完整行程。</p></div>
                <button type="button" onClick={() => setPanel("trip")}><Plus /></button>
              </div>
              <div className="lt-travel-trip-list">
                {trips.length ? trips.map((trip) => (
                  <button
                    type="button"
                    key={trip.id}
                    className={trip.id === selectedTripId ? "active" : ""}
                    onClick={() => selectTrip(trip)}
                  >
                    <span><strong>{trip.title}</strong><small>{shortDate(trip.startAt)}{trip.endAt ? ` → ${shortDate(trip.endAt)}` : ""}</small></span>
                    <em>{trip.visitCount} 站</em>
                  </button>
                )) : <p className="empty">还没有旅行。先创建一次行程，再把地点的访问记录加入旅行。</p>}
              </div>
              {selectedTrip ? (
                <div className="lt-travel-trip-summary">
                  <h3>{selectedTrip.title}</h3>
                  <p>{selectedTrip.description || "这次旅行还没有备注。"}</p>
                  <div><span>{selectedTripVisits.length}</span><small>已记录站点</small></div>
                  <button type="button" onClick={() => setMode("route")}><Route />查看路线</button>
                </div>
              ) : null}
            </div>
          ) : mode === "route" ? (
            <div className="lt-travel-route-panel">
              <div className="lt-travel-panel-heading">
                <div><span>Route</span><h2>旅行路线</h2><p>按 Visit 的顺序与日期连接已记录地点。</p></div>
              </div>
              <label className="lt-travel-trip-picker">
                旅行
                <select value={selectedTripId} onChange={(event) => setSelectedTripId(event.target.value)}>
                  <option value="">选择旅行</option>
                  {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
                </select>
              </label>
              {selectedTrip ? (
                <>
                  <h3>{selectedTrip.title}</h3>
                  <div className="lt-travel-route-stops">
                    {selectedTripVisits.length ? selectedTripVisits.map((visit, index) => (
                      <button
                        type="button"
                        key={visit.id}
                        onClick={() => {
                          const place = places.find((item) => item.id === visit.placeId);
                          if (place) {
                            setSelected(place);
                            setMode("map");
                          }
                        }}
                      >
                        <b>{index + 1}</b>
                        <span><strong>{visit.placeName}</strong><small>{shortDate(visit.arrivedAt)}</small></span>
                      </button>
                    )) : <p className="empty">这次旅行还没有站点。在地点详情里点击“记录这次到访”，并选择这次旅行。</p>}
                  </div>
                </>
              ) : <p className="empty">先选择或创建一次旅行。</p>}
            </div>
          ) : selected ? (
            <>
              <div className="lt-travel-detail-head">
                <div>
                  <span>地点</span>
                  <h2>{selected.name}</h2>
                  <p>{[selected.city, selected.province, selected.country].filter(Boolean).join(" · ") || "尚未补充地区信息"}</p>
                </div>
                <button type="button" aria-label="关闭地点详情" onClick={() => setSelected(null)}><X /></button>
              </div>
              <div className="lt-travel-place-metrics">
                <span><strong>{selected.visitCount}</strong><small>访问次数</small></span>
                <span><strong>{selected.photoCount}</strong><small>关联照片</small></span>
              </div>
              <button className="lt-travel-add-visit" type="button" onClick={() => {
                setVisitTripId(selectedTripId);
                setPanel("visit");
              }}>
                <CalendarDays />记录这次到访
              </button>
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
              <p>点击地图上的地点查看多次访问记录。双击真实地图也可以直接按经纬度创建地点。</p>
              {places.slice(0, 7).map((place) => (
                <button type="button" key={place.id} onClick={() => setSelected(place)}>
                  <span>{place.name}</span>
                  <small>{place.visitCount ? `${place.visitCount} 次到访` : "仅保存地点"}</small>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {panel !== "none" ? (
        <div className="lt-travel-sheet-backdrop" onMouseDown={() => !saving && setPanel("none")}>
          <section className="lt-travel-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>Travel</span><h2>{panel === "place" ? "添加地点" : panel === "trip" ? "新建旅行" : "记录到访"}</h2></div>
              <button type="button" onClick={() => setPanel("none")}><X /></button>
            </header>
            {panel === "place" ? (
              <div className="lt-travel-form">
                <label>地点名称<input autoFocus value={draftPlace.name} onChange={(event) => setDraftPlace((value) => ({ ...value, name: event.target.value }))} placeholder="例如：鼓浪屿" /></label>
                <label>城市<input value={draftPlace.city || ""} onChange={(event) => setDraftPlace((value) => ({ ...value, city: event.target.value }))} placeholder="厦门" /></label>
                <div className="row">
                  <label>纬度<input type="number" step="0.00001" value={draftPlace.latitude ?? ""} onChange={(event) => setDraftPlace((value) => ({ ...value, latitude: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
                  <label>经度<input type="number" step="0.00001" value={draftPlace.longitude ?? ""} onChange={(event) => setDraftPlace((value) => ({ ...value, longitude: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
                </div>
                <button type="button" className="primary" disabled={saving || !draftPlace.name.trim()} onClick={() => void createPlace()}>
                  {saving ? "保存中…" : "保存地点"}
                </button>
              </div>
            ) : panel === "trip" ? (
              <div className="lt-travel-form">
                <label>旅行名称<input autoFocus value={tripTitle} onChange={(event) => setTripTitle(event.target.value)} placeholder="例如：2026 厦门旅行" /></label>
                <div className="row">
                  <label>开始日期<input type="date" value={tripStartDate} onChange={(event) => setTripStartDate(event.target.value)} /></label>
                  <label>结束日期<input type="date" value={tripEndDate} onChange={(event) => setTripEndDate(event.target.value)} /></label>
                </div>
                <button type="button" className="primary" disabled={saving || !tripTitle.trim()} onClick={() => void createTrip()}>
                  {saving ? "创建中…" : "创建旅行"}
                </button>
              </div>
            ) : (
              <div className="lt-travel-form">
                <label>地点<input value={selected?.name || ""} disabled /></label>
                <label>日期<input type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} /></label>
                <label>所属旅行
                  <select value={visitTripId} onChange={(event) => setVisitTripId(event.target.value)}>
                    <option value="">独立足迹</option>
                    {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
                  </select>
                </label>
                <button type="button" className="primary" disabled={saving || !selected} onClick={() => void createVisit()}>
                  {saving ? "保存中…" : "保存访问记录"}
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
