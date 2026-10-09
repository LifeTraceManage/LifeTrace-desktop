import { useState } from "react";
import ExecutionModule from "@/src/components/feature/execution/ExecutionModule";
import CalendarView from "@/src/components/feature/life/CalendarView";

/** Keep the original life records calendar available alongside scheduled tasks. */
export default function DesktopCalendarWorkspace({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [view, setView] = useState<"schedule" | "life">("schedule");
  return (
    <section className="lt-unified-calendar" aria-label="日历工作区">
      <div className="lt-unified-calendar-switch" role="group" aria-label="日历内容">
        <button type="button" aria-pressed={view === "schedule"} className={view === "schedule" ? "active" : ""} onClick={() => setView("schedule")}>
          日程与未来任务
        </button>
        <button type="button" aria-pressed={view === "life"} className={view === "life" ? "active" : ""} onClick={() => setView("life")}>
          生活记录 · 打卡 / 收支 / 复盘
        </button>
      </div>
      {view === "schedule"
        ? <ExecutionModule onNavigate={onNavigate} initialTab="calendar" />
        : <CalendarView />}
    </section>
  );
}
