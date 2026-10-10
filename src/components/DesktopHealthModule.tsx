import { useMemo } from "react";
import { Activity, Dumbbell, HeartPulse, MoonStar } from "lucide-react";
import { useLifeStore } from "@/src/stores/useLifeStore";
import { EmptyState, StatDisplay } from "@/src/components/common";
import { dayKey } from "@/src/utils/format";
import MedicalReportBrowser from "@/src/components/MedicalReportBrowser";

export default function DesktopHealthModule() {
  const { activities, logs, reviews, workoutHistory } = useLifeStore();
  const today = dayKey();
  const recentReviews = reviews
    .filter((item) => item.reviewDate >= dayKey(new Date(Date.now() - 6 * 86400000)))
    .sort((a, b) => b.reviewDate.localeCompare(a.reviewDate));
  const completedToday = new Set(
    logs.filter((item) => item.createdAt.startsWith(today) && item.status !== "skipped")
      .map((item) => item.activityId),
  ).size;
  const weekWorkouts = workoutHistory.filter(
    (item) => Date.now() - new Date(item.occurredAt).getTime() < 7 * 86400000,
  );
  const averages = useMemo(() => {
    if (!recentReviews.length) return { mood: 0, energy: 0 };
    return {
      mood: recentReviews.reduce((sum, item) => sum + item.mood, 0) / recentReviews.length,
      energy: recentReviews.reduce((sum, item) => sum + item.energy, 0) / recentReviews.length,
    };
  }, [recentReviews]);

  return <div className="hx-view">
    <article className="hx-fitness-hero">
      <div>
        <span className="hx-kicker">本地健康概览</span>
        <h2>从你的坚持、训练与每日复盘整理状态</h2>
        <p>数据直接来自本机 SQLite；离线时仍可查看，联网后由 Sync 与云端保持一致。</p>
      </div>
      <div><HeartPulse/><span>近 7 天复盘</span><strong>{recentReviews.length} 天</strong></div>
    </article>
    <MedicalReportBrowser/>
    <div className="hx-metrics">
      <StatDisplay label="今日坚持" value={String(completedToday) + " / " + activities.length} sub="已完成项目" tone="positive"/>
      <StatDisplay label="本周训练" value={String(weekWorkouts.length)} sub="近 7 天训练次数"/>
      <StatDisplay label="平均心情" value={recentReviews.length ? averages.mood.toFixed(1) : "—"} sub="近 7 天 / 10"/>
      <StatDisplay label="平均精力" value={recentReviews.length ? averages.energy.toFixed(1) : "—"} sub="近 7 天 / 10"/>
    </div>
    <div className="hx-finance-grid">
      <article className="hx-panel">
        <header className="hx-panel-head"><div><span className="hx-kicker">状态</span><h2>最近复盘</h2></div></header>
        <div className="hx-panel-body">
          {recentReviews.length ? recentReviews.slice(0, 7).map((item) => <div className="hx-history-row" key={item.id}>
            <time>{item.reviewDate.slice(5)}</time>
            <div><strong>{item.bestThing || "每日复盘"}</strong><small>心情 {item.mood}/10 · 精力 {item.energy}/10</small></div>
            <MoonStar/>
          </div>) : <EmptyState title="还没有复盘数据" hint="完成每日复盘后，这里会显示最近状态。"/>}
        </div>
      </article>
      <article className="hx-panel">
        <header className="hx-panel-head"><div><span className="hx-kicker">活动</span><h2>本周训练</h2></div></header>
        <div className="hx-panel-body">
          {weekWorkouts.length ? weekWorkouts.slice(0, 7).map((item) => <div className="hx-history-row" key={item.id}>
            <time>{new Date(item.occurredAt).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"})}</time>
            <div><strong>{item.name}</strong><small>{Math.max(1,Math.round(item.durationSeconds/60))} 分钟 · {item.setCount} 组</small></div>
            <Dumbbell/>
          </div>) : <EmptyState title="本周暂无训练" hint="导入或记录训练后显示在这里。"/>}
        </div>
      </article>
    </div>
    <small className="lt-desktop-local-note"><Activity/>健康概览只使用 LifeTrace 已有记录，不替代专业医疗建议。</small>
  </div>;
}
