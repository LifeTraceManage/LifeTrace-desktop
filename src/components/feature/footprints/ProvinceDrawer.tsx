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
  selectedCityCode?: string | null;
  selectedCityName?: string | null;
  onSelectCity?: (code: string | null, name: string) => void;
  onOpenEntry: (entry: FootprintEntry) => void;
};

export default function ProvinceDrawer({
  summary,
  name,
  detail,
  loading,
  selectedCityCode,
  selectedCityName,
  onSelectCity,
  onOpenEntry,
}: Props) {
  const scopedEntries = selectedCityCode || selectedCityName
    ? (detail?.entries ?? []).filter((entry) =>
      (selectedCityCode && entry.cityCode === selectedCityCode)
      || (!selectedCityCode && selectedCityName && entry.cityName === selectedCityName))
    : detail?.entries ?? [];

  return (
    <aside className="footprint-province-drawer">
      <header>
        <span>{selectedCityName ? "城市详情" : "省份详情"}</span>
        <h2>{selectedCityName || summary?.provinceName || name}</h2>
        <p>
          {selectedCityName
            ? `${scopedEntries.length} 次足迹 · ${scopedEntries.reduce((sum, entry) => sum + entry.photoCount, 0)} 张照片`
            : summary
              ? `${summary.cityCount} 个城市 · ${summary.visitCount} 次足迹 · ${summary.photoCount} 张照片`
              : "还没有在这里记录足迹"}
        </p>
        {selectedCityName ? (
          <button
            type="button"
            className="footprint-city-clear"
            onClick={() => onSelectCity?.(null, "")}
          >
            查看全省
          </button>
        ) : null}
      </header>

      {loading
        ? <div className="footprint-drawer-empty">正在读取足迹…</div>
        : null}

      {!loading && detail?.cities.length ? (
        <section className="footprint-city-list">
          <h3>城市</h3>
          {detail.cities.map((city) => {
            const active = (selectedCityCode && city.cityCode === selectedCityCode)
              || (!selectedCityCode && selectedCityName === city.cityName);
            return (
              <button
                type="button"
                className={active ? "active" : ""}
                key={city.cityCode || city.cityName}
                onClick={() => onSelectCity?.(city.cityCode, city.cityName)}
              >
                <MapPin />
                <div>
                  <strong>{city.cityName}</strong>
                  <small>{city.visitCount} 次到访</small>
                </div>
                <span>{city.photoCount} 张</span>
              </button>
            );
          })}
        </section>
      ) : null}

      {!loading && scopedEntries.length ? (
        <section className="footprint-province-entries">
          <h3>{selectedCityName ? "城市回忆" : "回忆"}</h3>
          {scopedEntries.map((entry) => (
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

      {!loading && !scopedEntries.length ? (
        <div className="footprint-drawer-empty">
          <MapPin />
          <p>{selectedCityName ? "这个城市还没有足迹记录。" : "点击“添加足迹”，把第一次到访记录在这里。"}</p>
        </div>
      ) : null}
    </aside>
  );
}
