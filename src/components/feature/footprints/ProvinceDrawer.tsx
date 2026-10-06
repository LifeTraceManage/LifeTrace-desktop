import { CalendarDays, Camera, MapPin } from "lucide-react";
import type {
  FootprintEntry,
  ProvinceFootprintDetail,
  ProvinceFootprintSummary,
} from "./types";
import { footprintDateLabel } from "./footprintViewModel";

type Props = {
  summary: ProvinceFootprintSummary | null;
  name: string;
  detail: ProvinceFootprintDetail | null;
  loading: boolean;
  onOpenEntry: (entry: FootprintEntry) => void;
};

export default function ProvinceDrawer({
  summary,
  name,
  detail,
  loading,
  onOpenEntry,
}: Props) {
  return (
    <aside className="footprint-province-drawer">
      <header>
        <span>省份详情</span>
        <h2>{summary?.provinceName || name}</h2>
        <p>
          {summary
            ? `${summary.cityCount} 个城市 · ${summary.visitCount} 次足迹 · ${summary.photoCount} 张照片`
            : "还没有在这里记录足迹"}
        </p>
      </header>

      {loading
        ? <div className="footprint-drawer-empty">正在读取足迹…</div>
        : null}

      {!loading && detail?.cities.length ? (
        <section className="footprint-city-list">
          <h3>城市</h3>
          {detail.cities.map((city) => (
            <article key={city.cityCode || city.cityName}>
              <MapPin />
              <div>
                <strong>{city.cityName}</strong>
                <small>{city.visitCount} 次到访</small>
              </div>
              <span>{city.photoCount} 张</span>
            </article>
          ))}
        </section>
      ) : null}

      {!loading && detail?.entries.length ? (
        <section className="footprint-province-entries">
          <h3>回忆</h3>
          {detail.entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() => onOpenEntry(entry)}
            >
              <div>
                <strong>{entry.title}</strong>
                <small><CalendarDays />{footprintDateLabel(entry)}</small>
              </div>
              <span><Camera />{entry.photoCount}</span>
            </button>
          ))}
        </section>
      ) : null}

      {!loading && !detail?.entries.length ? (
        <div className="footprint-drawer-empty">
          <MapPin />
          <p>点击“添加足迹”，把第一次到访记录在这里。</p>
        </div>
      ) : null}
    </aside>
  );
}
