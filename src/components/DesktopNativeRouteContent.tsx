import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import Dashboard from "@/src/components/feature/dashboard/Dashboard";
import Habits from "@/src/components/feature/habits/Habits";
import Fitness from "@/src/components/feature/fitness/Fitness";
import Finance from "@/src/components/feature/finance/Finance";
import Transactions from "@/src/components/feature/finance/Transactions";
import Accounts from "@/src/components/feature/finance/Accounts";
import ImportBills from "@/src/components/feature/finance/ImportBills";
import CalendarView from "@/src/components/feature/life/CalendarView";
import ReviewView from "@/src/components/feature/life/ReviewView";
import ExecutionModule from "@/src/components/feature/execution/ExecutionModule";
import SettingsView from "@/src/components/feature/settings/SettingsView";
import EditorModal, { type EditorModalState } from "@/src/components/feature/forms/EditorModal";
import NotesModule from "@/src/components/NotesModule";
import PhotoSyncModule from "@/src/components/PhotoSyncModule";
import Footprints from "@/src/components/feature/footprints/Footprints";
import CloudAgentModule from "@/src/components/CloudAgentModule";
import DesktopSearchModule from "@/src/components/DesktopSearchModule";
import DesktopHealthModule from "@/src/components/DesktopHealthModule";
import { ConfirmDialogHost } from "@/src/ui/feedback/confirm";
import { noteApi } from "@/src/services/noteApi";
import { dayKey, escapeHtml } from "@/src/utils/format";
import type { Activity, Transaction, WorkoutHistory } from "@/src/types";

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
    case "notes": return "/app/notes";
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

  const makeLinkedNote = async (
    noteType: "habit_log" | "workout_review" | "expense_note",
    title: string,
    entityType: "habit" | "workout" | "transaction",
    entityId: string,
    text: string,
  ) => {
    const created = await noteApi.create({
      title,
      noteType,
      folderId: null,
      contentJson: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
      contentHtml: "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>",
      contentText: text,
      contentMarkdown: text,
      summary: text.replace(/\s+/g, " ").slice(0, 160),
      isPinned: false,
      isFavorite: false,
      isArchived: false,
      tagIds: [],
      relations: [{
        id: crypto.randomUUID(),
        noteId: "pending",
        entityType,
        entityId,
        relationType: "created_from",
        createdAt: new Date().toISOString(),
      }],
    });
    window.localStorage.setItem("lifetrace:last-note", created.id);
    navigate("/app/notes");
    window.dispatchEvent(new CustomEvent("hengxu-toast", { detail: "关联笔记已创建" }));
  };

  const openEntity = (entityType: string, entityId: string) => {
    switch (entityType) {
      case "note":
        window.localStorage.setItem("lifetrace:last-note", entityId);
        navigate("/app/notes");
        return;
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

  const habitNote = (value: Activity) => void makeLinkedNote(
    "habit_log",
    value.name + "练习记录 - " + dayKey(),
    "habit",
    value.id,
    "今天的记录：\n\n问题：\n\n下次重点：",
  );
  const workoutNote = (value: WorkoutHistory) => void makeLinkedNote(
    "workout_review",
    "训练复盘 - " + dayKey(new Date(value.occurredAt)),
    "workout",
    value.id,
    "训练名称：" + value.name
      + "\n训练日期：" + dayKey(new Date(value.occurredAt))
      + "\n训练时长：" + Math.max(1, Math.round(value.durationSeconds / 60)) + " 分钟"
      + "\n总容量：" + (value.volumeKg ?? "未记录")
      + "\n动作数量：" + value.exerciseCount
      + "\n训练来源：" + value.source,
  );
  const transactionNote = (value: Transaction) => void makeLinkedNote(
    "expense_note",
    "消费记录 - " + (value.counterparty || value.category),
    "transaction",
    value.id,
    "日期：" + dayKey(new Date(value.occurredAt))
      + "\n金额：¥" + value.amount.toFixed(2)
      + "\n分类：" + value.category
      + "\n账户：" + value.account
      + "\n商户：" + (value.counterparty || "未填写")
      + "\n消费目的：",
  );

  let content: React.ReactNode = null;
  if (route === "/app/today") {
    content = <Dashboard
      go={(view) => navigate(routeForLegacyView(view))}
      record={(value) => setModal({ kind: "record", value })}
      openNotes={(id) => {
        if (id) window.localStorage.setItem("lifetrace:last-note", id);
        navigate("/app/notes");
      }}
    />;
  } else if (route.startsWith("/app/execution")) {
    content = <ExecutionModule />;
  } else if (route === "/app/calendar") {
    content = <CalendarView />;
  } else if (route === "/app/habits") {
    content = <Habits
      edit={(value) => setModal({ kind: "activity", value })}
      record={(value) => setModal({ kind: "record", value })}
      note={habitNote}
    />;
  } else if (route === "/app/fitness") {
    content = <Fitness note={workoutNote} />;
  } else if (route === "/app/health") {
    content = <DesktopHealthModule />;
  } else if (route === "/app/review") {
    content = <ReviewView />;
  } else if (route === "/app/notes") {
    content = <NotesModule />;
  } else if (route === "/app/photos") {
    content = <PhotoSyncModule />;
  } else if (route === "/app/footprints") {
    content = <Footprints />;
  } else if (route === "/app/finance/transactions") {
    content = <Transactions edit={(value) => setModal({ kind: "transaction", value })} note={transactionNote} />;
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
      openNotes={() => navigate("/app/notes")}
    />;
  }

  return <>
    {route.startsWith("/app/finance") ? <nav className="lt-native-subnav" aria-label="财务导航">
      <button className={route === "/app/finance" ? "active" : ""} onClick={() => navigate("/app/finance")}>概览</button>
      <button className={route === "/app/finance/transactions" ? "active" : ""} onClick={() => navigate("/app/finance/transactions")}>账单</button>
      <button className={route === "/app/finance/accounts" ? "active" : ""} onClick={() => navigate("/app/finance/accounts")}>账户</button>
      <button className={route === "/app/finance/import" ? "active" : ""} onClick={() => navigate("/app/finance/import")}>导入</button>
    </nav> : null}
    {content}
    {modal ? <EditorModal modal={modal} close={() => setModal(null)} /> : null}
    {toast ? <div className="hx-toast" role="status"><Check aria-hidden="true"/>{toast}</div> : null}
    <ConfirmDialogHost />
  </>;
}
