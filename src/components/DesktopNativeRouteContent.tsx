import { lazy, Suspense, useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { EditorModalState } from "@/src/components/feature/forms/EditorModal";
import { ConfirmDialogHost } from "@/src/ui/feedback/confirm";

const Dashboard = lazy(() => import("@/src/components/feature/dashboard/Dashboard"));
const Habits = lazy(() => import("@/src/components/feature/habits/Habits"));
const Fitness = lazy(() => import("@/src/components/feature/fitness/Fitness"));
const Finance = lazy(() => import("@/src/components/feature/finance/Finance"));
const Transactions = lazy(() => import("@/src/components/feature/finance/Transactions"));
const Accounts = lazy(() => import("@/src/components/feature/finance/Accounts"));
const ImportBills = lazy(() => import("@/src/components/feature/finance/ImportBills"));
const ReviewView = lazy(() => import("@/src/components/feature/life/ReviewView"));
const ExecutionModule = lazy(() => import("@/src/components/feature/execution/ExecutionModule"));
const DesktopCalendarWorkspace = lazy(() => import("@/src/components/DesktopCalendarWorkspace"));
const SettingsView = lazy(() => import("@/src/components/feature/settings/SettingsView"));
const PhotoSyncModule = lazy(() => import("@/src/components/PhotoSyncModule"));
const Footprints = lazy(() => import("@/src/components/feature/footprints/Footprints"));
const MailActionCenter = lazy(() => import("@/src/components/feature/mail/MailActionCenter"));
const CloudAgentModule = lazy(() => import("@/src/components/CloudAgentModule"));
const DesktopSearchModule = lazy(() => import("@/src/components/DesktopSearchModule"));
const DesktopHealthModule = lazy(() => import("@/src/components/DesktopHealthModule"));
const EditorModal = lazy(() => import("@/src/components/feature/forms/EditorModal"));

type Props = {
  route: string;
  navigate: (route: string) => void;
};

function routeForLegacyView(view: string): string {
  switch (view) {
    case "habits": return "/app/habits";
    case "fitness": return "/app/fitness";
    case "transactions": return "/app/finance/transactions";
    case "accounts": return "/app/finance/accounts";
    case "finance": return "/app/finance";
    case "mail": return "/app/mail";
    case "calendar": return "/app/calendar";
    case "review": return "/app/review";
    case "execution": return "/app/execution";
    case "settings": return "/app/settings";
    default: return "/app/today";
  }
}

export default function DesktopNativeRouteContent({ route, navigate }: Props) {
  const [modal, setModal] = useState<EditorModalState>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<string | { message?: string }>).detail;
      const message = typeof detail === "string" ? detail : detail?.message;
      if (message) setToast(message);
    };
    window.addEventListener("hengxu-toast", receive);
    return () => window.removeEventListener("hengxu-toast", receive);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openEntity = (entityType: string, entityId: string) => {
    switch (entityType) {
      case "transaction":
        navigate("/app/finance/transactions");
        return;
      case "habit":
      case "activity_log":
        navigate("/app/habits");
        return;
      case "daily_review":
        navigate("/app/review");
        return;
      case "workout":
        navigate("/app/fitness");
        return;
      case "calendar_event":
      case "execution_task":
      case "memo":
        navigate("/app/execution");
        return;
      default:
        navigate("/app/today");
    }
  };

  let content: React.ReactNode = null;
  if (route === "/app/today") {
    content = <Dashboard
      go={(view) => navigate(routeForLegacyView(view))}
      record={(value) => setModal({ kind: "record", value })}
    />;
  } else if (route.startsWith("/app/execution")) {
    content = <ExecutionModule onNavigate={navigate} />;
  } else if (route === "/app/calendar") {
    content = <DesktopCalendarWorkspace onNavigate={navigate} />;
  } else if (route === "/app/habits") {
    content = <Habits
      edit={(value) => setModal({ kind: "activity", value })}
      record={(value) => setModal({ kind: "record", value })}
    />;
  } else if (route === "/app/fitness") {
    content = <Fitness />;
  } else if (route === "/app/health") {
    content = <DesktopHealthModule />;
  } else if (route === "/app/review") {
    content = <ReviewView />;
  } else if (route === "/app/photos") {
    content = <PhotoSyncModule />;
  } else if (route === "/app/footprints") {
    content = <Footprints />;
  } else if (route === "/app/mail") {
    content = <MailActionCenter />;
  } else if (route === "/app/finance/transactions") {
    content = <Transactions edit={(value) => setModal({ kind: "transaction", value })} />;
  } else if (route === "/app/finance/accounts") {
    content = <Accounts edit={(value) => setModal({ kind: "account", value })} />;
  } else if (route === "/app/finance/import") {
    content = <ImportBills />;
  } else if (route.startsWith("/app/finance")) {
    content = <Finance />;
  } else if (route === "/app/assistant") {
    content = <CloudAgentModule />;
  } else if (route === "/app/search") {
    content = <DesktopSearchModule onOpenEntity={openEntity} />;
  } else if (route.startsWith("/app/settings")) {
    content = <SettingsView />;
  } else {
    content = <Dashboard
      go={(view) => navigate(routeForLegacyView(view))}
      record={(value) => setModal({ kind: "record", value })}
    />;
  }

  return <>
    {route.startsWith("/app/finance") ? <nav className="lt-native-subnav" aria-label="财务导航">
      <button className={route === "/app/finance" ? "active" : ""} onClick={() => navigate("/app/finance")}>概览</button>
      <button className={route === "/app/finance/transactions" ? "active" : ""} onClick={() => navigate("/app/finance/transactions")}>账单</button>
      <button className={route === "/app/finance/accounts" ? "active" : ""} onClick={() => navigate("/app/finance/accounts")}>账户</button>
      <button className={route === "/app/finance/import" ? "active" : ""} onClick={() => navigate("/app/finance/import")}>导入</button>
    </nav> : null}
    <Suspense fallback={<div role="status" className="hx-view">正在加载模块…</div>}>
      {content}
    </Suspense>
    <Suspense fallback={null}>
      {modal ? <EditorModal modal={modal} close={() => setModal(null)} /> : null}
    </Suspense>
    {toast ? <div className="hx-toast" role="status"><Check aria-hidden="true"/>{toast}</div> : null}
    <ConfirmDialogHost />
  </>;
}
