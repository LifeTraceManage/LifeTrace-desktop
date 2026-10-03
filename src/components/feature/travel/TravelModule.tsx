import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  MapPinned,
  Plane,
  Plus,
  Route,
  Trash2,
  X,
} from "lucide-react";
import TravelMapLibre from "@/src/components/feature/travel/TravelMapLibre";
import {
  travelApi,
  type NewTravelPlace,
  type TravelPhotoCandidate,
  type TravelPhotoLink,
  type TravelPlace,
  type TravelSummary,
  type TravelTrip,
  type TravelVisit,
} from "@/src/services/travelApi";

const EMPTY_SUMMARY: TravelSummary = { placeCount: 0, visitCount: 0, tripCount: 0, photoCount: 0, cityCount: 0 };

type Panel = "none" | "place" | "trip" | "visit" | "photo";
type TravelMode = "map" | "trips" | "photos" | "route";

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
  const [photoLinks, setPhotoLinks] = useState<TravelPhotoLink[]>([]);
  const [photoCandidates, setPhotoCandidates] = useState<TravelPhotoCandidate[]>([]);
  const [selected, setSelected] = useState<TravelPlace | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<TravelPhotoLink | null>(null);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [mode, setMode] = useState<TravelMode>("map");
  const [panel, setPanel] = useState<Panel>("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoPickerLoading, setPhotoPickerLoading] = useState(false);
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
  const [photoTripId, setPhotoTripId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextPlaces, nextTrips, nextVisits, nextPhotoLinks] = await Promise.all([
        travelApi.summary(),
        travelApi.places.list(),
        travelApi.trips.list(),
        travelApi.visits.list(),
        travelApi.photoLinks.list(),
      ]);
      setSummary(nextSummary);
      setPlaces(nextPlaces);
      setTrips(nextTrips);
      setVisits(nextVisits);
      setPhotoLinks(nextPhotoLinks);
      setSelected((current) => current ? nextPlaces.find((item) => item.id === current.id) ?? null : null);
      setSelectedPhoto((current) => current ? nextPhotoLinks.find((item) => item.id === current.id) ?? null : null);
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

  const openPhotoPicker = async () => {
    if (!selected) return;
    setPhotoTripId(selectedTripId);
    setPhotoPickerLoading(true);
    setError("");
    setPanel("photo");
    try {
      setPhotoCandidates(await travelApi.photoCandidates.list(180));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片列表读取失败");
    } finally {
      setPhotoPickerLoading(false);
    }
  };

  const linkPhoto = async (candidate: TravelPhotoCandidate) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const created = await travelApi.photoLinks.create({
        photoId: candidate.photoId,
        placeId: selected.id,
        tripId: photoTripId || null,
        capturedAt: candidate.capturedAt || null,
      });
      await load();
      setSelectedPhoto(created);
      setMode("photos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片关联失败");
    } finally {
      setSaving(false);
    }
  };

  const unlinkPhoto = async (link: TravelPhotoLink) => {
    setSaving(true);
    setError("");
    try {
      await travelApi.photoLinks.remove(link.id);
      setSelectedPhoto(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片关联移除失败");
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
  const linkedPhotoIds = useMemo(
    () => new Set(photoLinks.filter((link) => link.placeId === selected?.id).map((link) => link.photoId)),
    [photoLinks, selected?.id],
  );
  const selectedPlacePhotos = useMemo(
    () => selected ? photoLinks.filter((link) => link.placeId === selected.id) : [],
    [photoLinks, selected],
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
          <button type="button" className={mode === "photos" ? "active" : ""} onClick={() => setMode("photos")}>
            <Camera />照片地图 <span>{summary.photoCount}</span>
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
              photoLinks={photoLinks}
              selectedPlaceId={selected?.id}
              selectedPhotoLinkId={selectedPhoto?.id}
              routeTripId={mode === "route" ? selectedTripId : null}
              showPhotos={mode === "photos"}
              onSelectPlace={(place) => {
                setSelected(place);
                setMode("map");
              }}
              onSelectPhoto={(photo) => {
                setSelectedPhoto(photo);
                setMode("photos");
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
          ) : mode === "photos" ? (
            <div className="lt-travel-photo-panel">
              <div className="lt-travel-panel-heading">
                <div><span>Photo Map</span><h2>照片地图</h2><p>照片本体仍由相册管理，这里只保存地点关联。</p></div>
              </div>
              {selectedPhoto ? (
                <article className="lt-travel-photo-detail">
                  <img src={selectedPhoto.thumbnailUrl} alt="" />
                  <h3>{selectedPhoto.originalFileName}</h3>
                  <p>{selectedPhoto.placeName || "自定义坐标"} · {shortDate(selectedPhoto.capturedAt)}</p>
                  <button type="button" disabled={saving} onClick={() => void unlinkPhoto(selectedPhoto)}>
                    <Trash2 />移除地图关联
                  </button>
                </article>
              ) : (
                <div className="lt-travel-photo-list">
                  {photoLinks.length ? photoLinks.slice(0, 40).map((photo) => (
                    <button type="button" key={photo.id} onClick={() => setSelectedPhoto(photo)}>
                      <img src={photo.thumbnailUrl} alt="" loading="lazy" />
                      <span><strong>{photo.placeName || photo.originalFileName}</strong><small>{shortDate(photo.capturedAt)}</small></span>
                    </button>
                  )) : (
                    <p className="empty">还没有地图照片。先在“地图”里选择地点，再点击“关联照片”。</p>
                  )}
                </div>
              )}
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
              <div className="lt-travel-place-actions">
                <button className="lt-travel-add-visit" type="button" onClick={() => {
                  setVisitTripId(selectedTripId);
                  setPanel("visit");
                }}>
                  <CalendarDays />记录到访
                </button>
                <button className="lt-travel-add-visit" type="button" onClick={() => void openPhotoPicker()}>
                  <Camera />关联照片
                </button>
              </div>
              {selectedPlacePhotos.length ? (
                <div className="lt-travel-place-photos">
                  {selectedPlacePhotos.slice(0, 6).map((photo) => (
                    <button type="button" key={photo.id} onClick={() => {
                      setSelectedPhoto(photo);
                      setMode("photos");
                    }}>
                      <img src={photo.thumbnailUrl} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : null}
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
              <div>
                <span>Travel</span>
                <h2>
                  {panel === "place" ? "添加地点"
                    : panel === "trip" ? "新建旅行"
                      : panel === "photo" ? "关联照片"
                        : "记录到访"}
                </h2>
              </div>
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
            ) : panel === "photo" ? (
              <div className="lt-travel-photo-picker">
                <label>关联到旅行
                  <select value={photoTripId} onChange={(event) => setPhotoTripId(event.target.value)}>
                    <option value="">不指定旅行</option>
                    {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
                  </select>
                </label>
                <p>地点：<strong>{selected?.name || "未选择"}</strong>。照片原文件不会移动或复制。</p>
                {photoPickerLoading ? <div className="lt-travel-photo-picker-loading">正在读取本机相册…</div> : (
                  <div className="lt-travel-photo-picker-grid">
                    {photoCandidates.map((candidate) => {
                      const linked = linkedPhotoIds.has(candidate.photoId);
                      return (
                        <button
                          type="button"
                          key={candidate.photoId}
                          className={linked ? "linked" : ""}
                          disabled={saving || linked}
                          onClick={() => void linkPhoto(candidate)}
                          title={linked ? "这张照片已关联到当前地点" : candidate.originalFileName}
                        >
                          <img src={candidate.thumbnailUrl} alt="" loading="lazy" />
                          <span>{linked ? "已关联" : shortDate(candidate.capturedAt || candidate.importedAt)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
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
