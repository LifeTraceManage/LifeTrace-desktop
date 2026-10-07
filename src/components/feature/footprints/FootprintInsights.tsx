import { Camera, History, MapPinned, Sparkles } from "lucide-react";
import type { FootprintInsightsValue } from "./footprintInsights";

export default function FootprintInsights({ value }: { value: FootprintInsightsValue }) {
  const maxYearVisits = Math.max(1, ...value.years.map((year) => year.visitCount));
  return (
    <section className="footprint-insights" aria-label="足迹深度统计">
      <div className="footprint-insight-metrics">
        <article><History /><span>记录年份</span><strong>{value.yearCount}</strong></article>
        <article><MapPinned /><span>重复到访</span><strong>{value.revisitCount}</strong></article>
        <article><Camera /><span>照片覆盖</span><strong>{value.photoCoveragePercent}%</strong></article>
      </div>
      <div className="footprint-year-stats">
        <header><div><Sparkles /><span><strong>年度足迹</strong><small>按真实记录和关联照片统计</small></span></div></header>
        {value.years.length ? (
          <div>
            {value.years.map((year) => (
              <article key={year.year}>
                <strong>{year.year}</strong>
                <span className="footprint-year-bar"><i style={{ width: `${Math.max(10, year.visitCount / maxYearVisits * 100)}%` }} /></span>
                <small>{year.visitCount} 次 · {year.photoCount} 张照片{year.favoriteCount ? ` · ${year.favoriteCount} 收藏` : ""}</small>
              </article>
            ))}
          </div>
        ) : <p>创建第一条足迹后会显示年度统计。</p>}
      </div>
      <div className="footprint-top-cities">
        <header><strong>常去城市</strong><small>按到访次数排序</small></header>
        {value.topCities.length ? value.topCities.map((city, index) => (
          <article key={city.label}>
            <b>{index + 1}</b><span><strong>{city.label}</strong><small>{city.photoCount} 张关联照片</small></span><em>{city.visitCount} 次</em>
          </article>
        )) : <p>暂无城市统计。</p>}
      </div>
    </section>
  );
}
