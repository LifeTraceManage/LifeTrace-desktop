import { invoke } from "@tauri-apps/api/core";
import type { Activity, ActivityLog, DailyReview, WorkoutHistory } from "@/src/types";
import { createId } from "@/src/utils/id";

export interface LifeData {
  activities: Activity[];
  logs: ActivityLog[];
  reviews: DailyReview[];
  settings: LifeSettings;
  workoutHistory: WorkoutHistory[];
}

export interface LifeSettings {
  id: "preferences";
  dark: boolean;
  timer: { activityId: string; startedAt: number | null; accumulatedSeconds: number } | null;
  updatedAt: string;
}

export type SQLiteMutation =
  | { operation: "put"; table: "activities" | "logs" | "reviews" | "settings" | "workoutHistory"; value: Activity | ActivityLog | DailyReview | LifeSettings | WorkoutHistory }
  | { operation: "patch"; table: "activities"; id: string; patch: Record<string, unknown> }
  | { operation: "delete"; table: "workoutHistory"; id: string }
  | { operation: "restore"; data: Omit<LifeData, "settings"> };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const request = async <T>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const payload = await response.json() as T & { error?: string };
  if(!response.ok) throw new Error(payload.error || "SQLite 数据服务暂时不可用");
  return payload;
};

export const loadSQLiteState = async (): Promise<LifeData> => {
  if (isTauriRuntime()) return invoke<LifeData>("state_get");
  return request<LifeData>("/api/state");
};

export const mutateSQLite = async (mutation: SQLiteMutation): Promise<{ ok: true }> => {
  if (isTauriRuntime()) return invoke<{ ok: true }>("state_mutate", { mutation });
  return request<{ ok: true }>("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mutation),
  });
};

export const now = () => new Date().toISOString();
export const uid = createId;
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
