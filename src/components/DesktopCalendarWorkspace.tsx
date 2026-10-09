import CalendarView from "@/src/components/feature/life/CalendarView";

/** The sidebar calendar is for life records. Planned tasks are in the execution workspace. */
export default function DesktopCalendarWorkspace({ onNavigate: _onNavigate }: { onNavigate: (route: string) => void }) {
  return <CalendarView />;
}
