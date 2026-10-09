import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CircleDollarSign,
  Dumbbell,
  FileUp,
  Home,
  Images,
  ListChecks,
  Mail,
  MapPinned,
  WalletCards,
} from "lucide-react";
import type { NavGroup } from "./AppShell";

export type PlatformView =
  | "dashboard"
  | "execution"
  | "mail"
  | "habits"
  | "fitness"
  | "photos"
  | "footprints"
  | "finance"
  | "transactions"
  | "accounts"
  | "import"
  | "calendar"
  | "review"
  | "analytics"
  | "settings"
  | "gallery";

export const navGroups: NavGroup[] = [
  {
    label: "今天",
    items: [
      { id: "dashboard", label: "今天", icon: Home },
      { id: "execution", label: "执行", icon: ListChecks },
    ],
  },
  {
    label: "生活",
    items: [
      { id: "habits", label: "坚持", icon: Check },
      { id: "fitness", label: "健身", icon: Dumbbell },
    ],
  },
  {
    label: "记录",
    items: [
      { id: "photos", label: "照片", icon: Images },
      { id: "footprints", label: "足迹", icon: MapPinned },
      { id: "mail", label: "邮件", icon: Mail },
    ],
  },
  {
    label: "财务",
    items: [
      { id: "finance", label: "概览", icon: BarChart3 },
      { id: "transactions", label: "账单", icon: CircleDollarSign },
      { id: "accounts", label: "账户", icon: WalletCards },
      { id: "import", label: "导入", icon: FileUp },
    ],
  },
  {
    label: "回顾",
    items: [
      { id: "calendar", label: "日历", icon: CalendarDays },
      { id: "review", label: "复盘", icon: BookOpen },
      { id: "analytics", label: "分析", icon: BarChart3 },
    ],
  },
];

export const pageTitles: Record<PlatformView, string> = {
  dashboard: "今天",
  execution: "执行中心",
  mail: "邮件行动中心",
  habits: "坚持",
  fitness: "健身训练",
  photos: "照片",
  footprints: "足迹",
  finance: "财务",
  transactions: "账单",
  accounts: "账户",
  import: "导入账单",
  calendar: "生活日历",
  review: "每日复盘",
  analytics: "分析与洞察",
  settings: "设置",
  gallery: "设计系统",
};

export function isPlatformView(value: string): value is PlatformView {
  return value in pageTitles;
}
