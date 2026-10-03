import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  ChevronDown,
  ChevronUp,
  MapPinned,
  Pencil,
  Plane,
  Plus,
  Route,
  Search,
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

function travelYear(value?: string | null) {
  if (!value) return null;
  const direct = value.match(/^(\d{4})/);
  if (direct) return direct[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : String(date.getFullYear());
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
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [editingPlaceId, setEditingPlaceId] = useState("");
  const [editingTripId, setEditingTripId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoPickerLoading, setPhotoPickerLoading] = useState(false);
  const [photoPickerMode, setPhotoPickerMode] = useState<"place" | "gps">("place");
  const [pendingPhotoLinkId, setPendingPhotoLinkId] = useState("");
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
    setPendingPhotoLinkId("");
    setEditingPlaceId("");
    setDraftPlace({ name: "", placeType: "custom", latitude, longitude });
    setPanel("place");
  };

  const openEditPlace = (place: TravelPlace) => {
    setPendingPhotoLinkId("");
    setEditingPlaceId(place.id);
    setDraftPlace({
      name: place.name,
      country: place.country,
      countryCode: place.countryCode,
      province: place.province,
      city: place.city,
      latitude: place.latitude,
      longitude: place.longitude,
      placeType: place.placeType,
    });
    setPanel("place");
  };

  const createPlace = async () => {
    if (!draftPlace.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...draftPlace,
        name: draftPlace.name.trim(),
        city: draftPlace.city?.trim() || draftPlace.name.trim(),
      };
      const saved = editingPlaceId
        ? await travelApi.places.update(editingPlaceId, payload)
        : await travelApi.places.create(payload);
      const assignedPhoto = pendingPhotoLinkId
        ? await travelApi.photoLinks.assignPlace(pendingPhotoLinkId, saved.id)
        : null;
      await load();
      setSelected(saved);
      setEditingPlaceId("");
      setPendingPhotoLinkId("");
      if (assignedPhoto) {
        setSelectedPhoto(assignedPhoto);
        setMode("photos");
      } else {
        setMode("map");
      }
      setPanel("none");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地点保存失败");
    } finally {
      setSaving(false);
    }
  };

  const openNewTrip = () => {
    setEditingTripId("");
    setTripTitle("");
    setTripStartDate("");
    setTripEndDate("");
    setPanel("trip");
  };

  const openEditTrip = (trip: TravelTrip) => {
    setEditingTripId(trip.id);
    setTripTitle(trip.title);
    setTripStartDate(trip.startAt ? trip.startAt.slice(0, 10) : "");
    setTripEndDate(trip.endAt ? trip.endAt.slice(0, 10) : "");
    setPanel("trip");
  };

  const createTrip = async () => {
    if (!tripTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: tripTitle.trim(),
        startAt: dateToIso(tripStartDate),
        endAt: dateToIso(tripEndDate),
      };
      const saved = editingTripId
        ? await travelApi.trips.update(editingTripId, payload)
        : await travelApi.trips.create(payload);
      setSelectedTripId(saved.id);
      setEditingTripId("");
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

  const refreshPhotoCandidates = async () => {
    setPhotoPickerLoading(true);
    setError("");
    try {
      setPhotoCandidates(await travelApi.photoCandidates.list(180));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "照片列表读取失败");
    } finally {
      setPhotoPickerLoading(false);
    }
  };

  const openPhotoPicker = async () => {
    if (!selected) return;
    setPhotoPickerMode("place");
    setPhotoTripId(selectedTripId);
    setPanel("photo");
    await refreshPhotoCandidates();
  };

  const openGpsPhotoPicker = async () => {
    setPhotoPickerMode("gps");
    setPhotoTripId(selectedTripId);
    setPanel("photo");
    await refreshPhotoCandidates();
  };

  const linkPhoto = async (candidate: TravelPhotoCandidate) => {
    const hasGps = candidate.latitude != null && candidate.longitude != null;
    if (photoPickerMode === "place" && !selected) return;
    if (photoPickerMode === "gps" && !hasGps) return;
    setSaving(true);
    setError("");
    try {
      const created = await travelApi.photoLinks.create({
        photoId: candidate.photoId,
        placeId: photoPickerMode === "place" ? selected?.id ?? null : null,
        tripId: photoTripId || null,
        capturedAt: candidate.capturedAt || null,
        latitude: candidate.latitude ?? null,
        longitude: candidate.longitude ?? null,
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

  const createPlaceFromPhoto = (photo: TravelPhotoLink) => {
    if (photo.latitude == null || photo.longitude == null) return;
    setPendingPhotoLinkId(photo.id);
    setEditingPlaceId("");
    setDraftPlace({
      name: "",
      placeType: "custom",
      latitude: photo.latitude,
      longitude: photo.longitude,
    });
    setPanel("place");
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

  const deleteSelectedPlace = async () => {
    if (!selected || !window.confirm(`删除地点“${selected.name}”？`)) return;
    setSaving(true);
    setError("");
    try {
      await travelApi.places.remove(selected.id);
      setSelected(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "地点删除失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedTrip = async () => {
    if (!selectedTrip || !window.confirm(`删除旅行“${selectedTrip.title}”？访问记录和照片会保留，只解除旅行归属。`)) return;
    setSaving(true);
    setError("");
    try {
      await travelApi.trips.remove(selectedTrip.id);
      setSelectedTripId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "旅行删除失败");
    } finally {
      setSaving(false);
    }
  };

  const deleteVisit = async (visit: TravelVisit) => {
    if (!window.confirm(`删除 ${visit.placeName} 的这次到访记录？`)) return;
    setSaving(true);
    setError("");
    try {
      await travelApi.visits.remove(visit.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "访问记录删除失败");
    } finally {
      setSaving(false);
    }
  };

  const moveVisit = async (visitId: string, direction: -1 | 1) => {
    if (!selectedTrip) return;
    const ordered = selectedTripVisits.map((visit) => visit.id);
    const index = ordered.indexOf(visitId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setSaving(true);
    setError("");
    try {
      await travelApi.trips.reorder(selectedTrip.id, ordered);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "路线顺序保存失败");
    } finally {
      setSaving(false);
    }
  };

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    const collect = (value?: string | null) => {
      const year = travelYear(value);
      if (year) years.add(year);
    };
    trips.forEach((trip) => {
      collect(trip.startAt);
      collect(trip.endAt);
    });
    visits.forEach((visit) => {
      collect(visit.arrivedAt);
      collect(visit.leftAt);
    });
    photoLinks.forEach((photo) => collect(photo.capturedAt));
    return [...years].sort((left, right) => Number(right) - Number(left));
  }, [photoLinks, trips, visits]);

  const filteredTrips = useMemo(() => trips.filter((trip) => {
    const tripVisits = visits.filter((visit) => visit.tripId === trip.id);
    const queryValues = [
      trip.title,
      trip.description,
      ...tripVisits.map((visit) => visit.placeName),
    ];
    const queryMatches = !normalizedSearch || queryValues.some((value) =>
      value?.toLocaleLowerCase().includes(normalizedSearch)
    );
    const yearMatches = yearFilter === "all" || [
      trip.startAt,
      trip.endAt,
      ...tripVisits.flatMap((visit) => [visit.arrivedAt, visit.leftAt]),
    ].some((value) => travelYear(value) === yearFilter);
    return queryMatches && yearMatches;
  }), [normalizedSearch, trips, visits, yearFilter]);

  const filteredPhotoLinks = useMemo(() => photoLinks.filter((photo) => {
    const tripTitle = photo.tripId ? trips.find((trip) => trip.id === photo.tripId)?.title : null;
    const queryMatches = !normalizedSearch || [
      photo.originalFileName,
      photo.placeName,
      tripTitle,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
    const yearMatches = yearFilter === "all" || travelYear(photo.capturedAt) === yearFilter;
    return queryMatches && yearMatches;
  }), [normalizedSearch, photoLinks, trips, yearFilter]);

  const filteredPlaces = useMemo(() => places.filter((place) => {
    const placeVisits = visits.filter((visit) => visit.placeId === place.id);
    const placePhotos = photoLinks.filter((photo) => photo.placeId === place.id);
    const tripTitles = placeVisits
      .map((visit) => visit.tripId ? trips.find((trip) => trip.id === visit.tripId)?.title : null)
      .filter(Boolean);
    const queryMatches = !normalizedSearch || [
      place.name,
      place.city,
      place.province,
      place.country,
      ...tripTitles,
      ...placePhotos.map((photo) => photo.originalFileName),
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
    const yearValues = [
      ...placeVisits.flatMap((visit) => [visit.arrivedAt, visit.leftAt]),
      ...placePhotos.map((photo) => photo.capturedAt),
      ...placeVisits.flatMap((visit) => {
        const trip = visit.tripId ? trips.find((item) => item.id === visit.tripId) : null;
        return trip ? [trip.startAt, trip.endAt] : [];
      }),
    ];
    const yearMatches = yearFilter === "all" || yearValues.some((value) => travelYear(value) === yearFilter);
    return queryMatches && yearMatches;
  }), [normalizedSearch, photoLinks, places, trips, visits, yearFilter]);

  const hasFilters = Boolean(normalizedSearch) || yearFilter !== "all";

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
    () => new Set(photoLinks.map((link) => link.photoId)),
    [photoLinks],
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
            setEditingPlaceId("");
            setDraftPlace({ name: "", placeType: "custom" });
            setPanel("place");
          }}>
            <Plus />添加地点
          </button>
          <button type="button" className="primary" onClick={openNewTrip}>
            <Plus />新建旅行
          </button>
        </div>
      </header>

      <div className="lt-travel-filters">
        <label className="lt-travel-search">
          <Search />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索地点、城市、旅行或照片"
            aria-label="搜索旅行足迹"
          />
          {searchQuery ? (
            <button type="button" onClick={() => setSearchQuery("")} aria-label="清除搜索"><X /></button>
          ) : null}
        </label>
        <select
          className="lt-travel-year-filter"
          value={yearFilter}
          onChange={(event) => setYearFilter(event.target.value)}
          aria-label="按年份筛选"
        >
          <option value="all">全部年份</option>
          {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <span className="lt-travel-filter-count">
          {filteredPlaces.length} 地点 · {filteredTrips.length} 旅行 · {filteredPhotoLinks.length} 照片
        </span>
        {hasFilters ? (
          <button
            type="button"
            className="lt-travel-clear-filters"
            onClick={() => {
              setSearchQuery("");
              setYearFilter("all");
            }}
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {error ? <div className="lt-travel-error" role="alert">{error}</div> : null}

      <div className="lt-travel-layout">
        <div className="lt-travel-canvas">
          {loading ? (
            <div className="lt-travel-loading">正在读取本机旅行足迹…</div>
          ) : (
            <TravelMapLibre
              places={filteredPlaces}
              visits={visits}
              photoLinks={filteredPhotoLinks}
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
                <button type="button" onClick={openNewTrip}><Plus /></button>
              </div>
              <div className="lt-travel-trip-list">
                {filteredTrips.length ? filteredTrips.map((trip) => (
                  <button
                    type="button"
                    key={trip.id}
                    className={trip.id === selectedTripId ? "active" : ""}
                    onClick={() => selectTrip(trip)}
                  >
                    <span><strong>{trip.title}</strong><small>{shortDate(trip.startAt)}{trip.endAt ? ` → ${shortDate(trip.endAt)}` : ""}</small></span>
                    <em>{trip.visitCount} 站</em>
                  </button>
                )) : <p className="empty">{hasFilters ? "没有符合当前筛选条件的旅行。" : "还没有旅行。先创建一次行程，再把地点的访问记录加入旅行。"}</p>}
              </div>
              {selectedTrip && filteredTrips.some((trip) => trip.id === selectedTrip.id) ? (
                <div className="lt-travel-trip-summary">
                  <h3>{selectedTrip.title}</h3>
                  <p>{selectedTrip.description || "这次旅行还没有备注。"}</p>
                  <div><span>{selectedTripVisits.length}</span><small>已记录站点</small></div>
                  <div className="lt-travel-trip-actions">
                    <button type="button" onClick={() => setMode("route")}><Route />查看路线</button>
                    <button type="button" onClick={() => openEditTrip(selectedTrip)}><Pencil />编辑</button>
                    <button type="button" className="danger" disabled={saving} onClick={() => void deleteSelectedTrip()}><Trash2 />删除</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : mode === "photos" ? (
            <div className="lt-travel-photo-panel">
              <div className="lt-travel-panel-heading">
                <div><span>Photo Map</span><h2>照片地图</h2><p>照片本体仍由相册管理，这里只保存地点关联。</p></div>
                <button type="button" onClick={() => void openGpsPhotoPicker()} title="导入带 GPS 的照片"><Plus /></button>
              </div>
              {selectedPhoto && filteredPhotoLinks.some((photo) => photo.id === selectedPhoto.id) ? (
                <article className="lt-travel-photo-detail">
                  <img src={selectedPhoto.thumbnailUrl} alt="" />
                  <h3>{selectedPhoto.originalFileName}</h3>
                  <p>{selectedPhoto.placeName || "照片定位"} · {shortDate(selectedPhoto.capturedAt)}</p>
                  {!selectedPhoto.placeId && selectedPhoto.latitude != null && selectedPhoto.longitude != null ? (
                    <button type="button" disabled={saving} onClick={() => createPlaceFromPhoto(selectedPhoto)}>
                      <MapPinned />在此位置创建地点
                    </button>
                  ) : null}
                  <button type="button" disabled={saving} onClick={() => void unlinkPhoto(selectedPhoto)}>
                    <Trash2 />移除地图关联
                  </button>
                </article>
              ) : (
                <div className="lt-travel-photo-list">
                  {filteredPhotoLinks.length ? filteredPhotoLinks.slice(0, 40).map((photo) => (
                    <button type="button" key={photo.id} onClick={() => setSelectedPhoto(photo)}>
                      <img src={photo.thumbnailUrl} alt="" loading="lazy" />
                      <span><strong>{photo.placeName || photo.originalFileName}</strong><small>{shortDate(photo.capturedAt)}</small></span>
                    </button>
                  )) : (
                    <div className="empty">
                      <p>{hasFilters ? "没有符合当前筛选条件的地图照片。" : "还没有地图照片。可以直接导入相册里带 GPS 的照片，或先选择地点再关联照片。"}</p>
                      <button type="button" onClick={() => void openGpsPhotoPicker()}><Camera />导入定位照片</button>
                    </div>
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
                      <div className="lt-travel-route-stop" key={visit.id}>
                        <button
                          type="button"
                          className="lt-travel-route-main"
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
                        <span className="lt-travel-route-order">
                          <button type="button" disabled={saving || index === 0} onClick={() => void moveVisit(visit.id, -1)} aria-label="上移"><ChevronUp /></button>
                          <button type="button" disabled={saving || index === selectedTripVisits.length - 1} onClick={() => void moveVisit(visit.id, 1)} aria-label="下移"><ChevronDown /></button>
                        </span>
                      </div>
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
              <div className="lt-travel-detail-actions">
                <button type="button" onClick={() => openEditPlace(selected)}><Pencil />编辑地点</button>
                <button type="button" className="danger" disabled={saving} onClick={() => void deleteSelectedPlace()}><Trash2 />删除</button>
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
                    <button type="button" disabled={saving} onClick={() => void deleteVisit(visit)}><Trash2 />删除记录</button>
                  </article>
                )) : <p className="empty">还没有访问记录，地点已经保存到足迹库。</p>}
              </div>
            </>
          ) : (
            <div className="lt-travel-empty-detail">
              <MapPinned />
              <h2>选择一个足迹</h2>
              <p>点击地图上的地点查看多次访问记录。双击真实地图也可以直接按经纬度创建地点。</p>
              {filteredPlaces.slice(0, 7).map((place) => (
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
                  {panel === "place" ? (editingPlaceId ? "编辑地点" : "添加地点")
                    : panel === "trip" ? (editingTripId ? "编辑旅行" : "新建旅行")
                      : panel === "photo" ? (photoPickerMode === "gps" ? "导入定位照片" : "关联照片")
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
                  {saving ? "保存中…" : editingPlaceId ? "保存修改" : "保存地点"}
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
                  {saving ? "保存中…" : editingTripId ? "保存修改" : "创建旅行"}
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
                <p>
                  {photoPickerMode === "gps"
                    ? "仅显示可直接加入地图的定位状态；没有 GPS 的照片不会被导入。"
                    : <>地点：<strong>{selected?.name || "未选择"}</strong>。照片原文件不会移动或复制。</>}
                </p>
                <button type="button" className="lt-travel-photo-scan" disabled={photoPickerLoading} onClick={() => void refreshPhotoCandidates()}>
                  继续扫描旧照片 EXIF
                </button>
                {photoPickerLoading ? <div className="lt-travel-photo-picker-loading">正在读取本机相册…</div> : (
                  <div className="lt-travel-photo-picker-grid">
                    {photoCandidates.map((candidate) => {
                      const linked = linkedPhotoIds.has(candidate.photoId);
                      const hasGps = candidate.latitude != null && candidate.longitude != null;
                      const unavailable = photoPickerMode === "gps" && !hasGps;
                      return (
                        <button
                          type="button"
                          key={candidate.photoId}
                          className={linked ? "linked" : unavailable ? "unavailable" : ""}
                          disabled={saving || linked || unavailable}
                          onClick={() => void linkPhoto(candidate)}
                          title={linked ? "这张照片已加入旅行地图" : unavailable ? "照片没有 GPS 定位" : candidate.originalFileName}
                        >
                          <img src={candidate.thumbnailUrl} alt="" loading="lazy" />
                          <span>
                            {linked
                              ? "已加入"
                              : unavailable
                                ? "无定位"
                                : `${hasGps ? "有定位 · " : ""}${shortDate(candidate.capturedAt || candidate.importedAt)}`}
                          </span>
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
