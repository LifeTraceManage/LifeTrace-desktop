import { Camera, CalendarDays, MapPinned, Plane } from "lucide-react";
import type { TravelPhotoLink, TravelPlace, TravelTrip } from "@/src/services/travelApi";
import type { TravelStats, TravelTimelineItem } from "@/src/components/feature/travel/travelInsights";

function formatMonth(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year} 年 ${Number(month)} 月`;
}

function formatDay(value: string) {
  const direct = value.match(/^\d{4}-\d{2}-(\d{2})/);
  if (direct) return direct[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : String(date.getDate()).padStart(2, "0");
}

export function TravelTimelineView({
  items,
  places,
  trips,
  photoLinks,
  onSelectPlace,
  onSelectTrip,
  onSelectPhoto,
}: {
  items: TravelTimelineItem[];
  places: TravelPlace[];
  trips: TravelTrip[];
  photoLinks: TravelPhotoLink[];
  onSelectPlace: (place: TravelPlace) => void;
  onSelectTrip: (trip: TravelTrip) => void;
  onSelectPhoto: (photo: TravelPhotoLink) => void;
}) {
  const groups = new Map<string, TravelTimelineItem[]>();
  items.forEach((item) => {
    const bucket = groups.get(item.monthKey) ?? [];
    bucket.push(item);
    groups.set(item.monthKey, bucket);
  });

  if (!items.length) {
    return (
      <div className="lt-travel-insight-empty">
        <CalendarDays />
        <h2>还没有时间线内容</h2>
        <p>记录旅行、到访或地图照片后，这里会按月份整理你的旅行轨迹。</p>
      </div>
    );
  }

  return (
    <div className="lt-travel-timeline">
      <header className="lt-travel-insight-heading">
        <span>Timeline</span>
        <h2>旅行时间线</h2>
        <p>旅行、到访和照片按时间合并展示，受当前搜索和年份筛选影响。</p>
      </header>
      {[...groups.entries()].map(([monthKey, monthItems]) => (
        <section className="lt-travel-timeline-month" key={monthKey}>
          <div className="lt-travel-timeline-month-label">{formatMonth(monthKey)}</div>
          <div className="lt-travel-timeline-events">
            {monthItems.map((item) => {
              const photo = item.photoLinkId ? photoLinks.find((entry) => entry.id === item.photoLinkId) : null;
              return (
                <button
                  type="button"
                  className={`lt-travel-timeline-event ${item.kind}`}
                  key={item.id}
                  onClick={() => {
                    if (item.kind === "trip" && item.tripId) {
                      const trip = trips.find((entry) => entry.id === item.tripId);
                      if (trip) onSelectTrip(trip);
                      return;
                    }
                    if (item.kind === "photo" && photo) {
                      onSelectPhoto(photo);
                      return;
                    }
                    if (item.placeId) {
                      const place = places.find((entry) => entry.id === item.placeId);
                      if (place) onSelectPlace(place);
                    }
                  }}
                >
                  <span className="lt-travel-timeline-day">{formatDay(item.occurredAt)}</span>
                  <span className="lt-travel-timeline-icon">
                    {item.kind === "trip" ? <Plane /> : item.kind === "photo" ? <Camera /> : <MapPinned />}
                  </span>
                  {photo ? <img src={photo.thumbnailUrl} alt="" loading="lazy" /> : null}
                  <span className="lt-travel-timeline-copy">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TravelStatsView({ stats }: { stats: TravelStats }) {
  const maxActivity = Math.max(
    1,
    ...stats.yearStats.map((item) => item.trips + item.visits + item.photos),
  );

  return (
    <div className="lt-travel-stats-view">
      <header className="lt-travel-insight-heading">
        <span>Stats</span>
        <h2>旅行统计</h2>
        <p>统计范围与当前搜索、年份筛选保持一致。</p>
      </header>

      <div className="lt-travel-stats-grid">
        <article><strong>{stats.countryCount}</strong><span>国家 / 地区</span></article>
        <article><strong>{stats.cityCount}</strong><span>城市</span></article>
        <article><strong>{stats.tripCount}</strong><span>旅行</span></article>
        <article><strong>{stats.visitCount}</strong><span>到访记录</span></article>
        <article><strong>{stats.photoCount}</strong><span>地图照片</span></article>
        <article><strong>{stats.revisitedPlaceCount}</strong><span>重复到访地点</span></article>
      </div>

      <section className="lt-travel-stat-section">
        <div className="lt-travel-stat-section-heading">
          <div><span>Yearly activity</span><h3>年度活动</h3></div>
          <small>{stats.yearStats.length} 个年份</small>
        </div>
        {stats.yearStats.length ? (
          <div className="lt-travel-year-bars">
            {stats.yearStats.map((item) => {
              const total = item.trips + item.visits + item.photos;
              return (
                <article key={item.year}>
                  <div className="lt-travel-year-bar-label">
                    <strong>{item.year}</strong>
                    <span>{item.trips} 旅行 · {item.visits} 到访 · {item.photos} 照片</span>
                  </div>
                  <div className="lt-travel-year-bar-track">
                    <span style={{ width: `${Math.max(4, (total / maxActivity) * 100)}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : <p className="empty">当前范围还没有可统计的时间数据。</p>}
      </section>

      <section className="lt-travel-stat-section">
        <div className="lt-travel-stat-section-heading">
          <div><span>Revisit</span><h3>重复到访</h3></div>
        </div>
        {stats.mostVisitedPlace ? (
          <div className="lt-travel-top-place">
            <MapPinned />
            <div>
              <strong>{stats.mostVisitedPlace.name}</strong>
              <span>当前范围内到访 {stats.mostVisitedPlace.count} 次</span>
            </div>
          </div>
        ) : <p className="empty">还没有到访记录。</p>}
      </section>
    </div>
  );
}
