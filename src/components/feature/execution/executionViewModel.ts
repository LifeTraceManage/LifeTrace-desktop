import { browserTimezone, type ExecutionTask, type TaskInput, type WaitingItem } from "@/src/services/executionApi";
import type { Activity, ActivityLog } from "@/src/types";

export function preserveTaskUpdateFields(task: ExecutionTask, input: TaskInput): TaskInput {
  return {
    title: input.title ?? task.title,
    description: input.description !== undefined ? input.description : task.description ?? null,
    projectId: input.projectId !== undefined ? input.projectId : task.projectId ?? null,
    priority: input.priority ?? task.priority,
    estimatedMinutes: input.estimatedMinutes !== undefined ? input.estimatedMinutes : task.estimatedMinutes ?? null,
    actualMinutes: input.actualMinutes !== undefined ? input.actualMinutes : task.actualMinutes ?? null,
    dueAt: input.dueAt !== undefined ? input.dueAt : task.dueAt ?? null,
    scheduledStartAt: input.scheduledStartAt !== undefined ? input.scheduledStartAt : task.scheduledStartAt ?? null,
    scheduledEndAt: input.scheduledEndAt !== undefined ? input.scheduledEndAt : task.scheduledEndAt ?? null,
    timezone: input.timezone || task.timezone || browserTimezone(),
    context: input.context !== undefined ? input.context : task.context ?? null,
  };
}

export function waitingToTaskInput(item: WaitingItem): TaskInput & { resolveSource: true } {
  return {
    title: item.title,
    description: item.description || null,
    priority: "normal",
    dueAt: item.expectedAt || null,
    timezone: browserTimezone(),
    context: item.waitingFor ? `等待：${item.waitingFor}` : null,
    resolveSource: true,
  };
}

export function normalizeWeekdays(values: number[]): number[] {
  return [...new Set(values)]
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
    .sort((a, b) => a - b);
}

export function isOpenExecutionTask(task: ExecutionTask): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

export function isExecutionInboxTask(task: ExecutionTask): boolean {
  return isOpenExecutionTask(task)
    && !task.projectId
    && !task.dueAt
    && !task.scheduledStartAt;
}

export function scheduleTaskInput(
  task: ExecutionTask,
  startAt: string,
  durationMinutes: number,
): TaskInput {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) throw new Error("计划开始时间无效");
  const minutes = Math.max(15, Math.round(durationMinutes || 60));
  return preserveTaskUpdateFields(task, {
    title: task.title,
    scheduledStartAt: start.toISOString(),
    scheduledEndAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    estimatedMinutes: minutes,
    context: null,
  });
}

export function shiftScheduledTaskInput(task: ExecutionTask, deltaMinutes: number): TaskInput {
  if (!task.scheduledStartAt) throw new Error("任务尚未安排具体时间");
  const start = new Date(task.scheduledStartAt);
  if (Number.isNaN(start.getTime())) throw new Error("任务计划时间无效");
  const currentEnd = task.scheduledEndAt ? new Date(task.scheduledEndAt) : null;
  const duration = currentEnd && !Number.isNaN(currentEnd.getTime())
    ? Math.max(15, Math.round((currentEnd.getTime() - start.getTime()) / 60_000))
    : Math.max(15, task.estimatedMinutes ?? 60);
  const nextStart = new Date(start.getTime() + deltaMinutes * 60_000);
  return preserveTaskUpdateFields(task, {
    title: task.title,
    scheduledStartAt: nextStart.toISOString(),
    scheduledEndAt: new Date(nextStart.getTime() + duration * 60_000).toISOString(),
  });
}

export function resizeScheduledTaskInput(task: ExecutionTask, deltaMinutes: number): TaskInput {
  if (!task.scheduledStartAt) throw new Error("任务尚未安排具体时间");
  const start = new Date(task.scheduledStartAt);
  if (Number.isNaN(start.getTime())) throw new Error("任务计划时间无效");
  const minutes = Math.max(15, (task.estimatedMinutes ?? 60) + deltaMinutes);
  return preserveTaskUpdateFields(task, {
    title: task.title,
    estimatedMinutes: minutes,
    scheduledEndAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
  });
}

export function habitScheduledOnDate(activity: Activity, dateKey: string): boolean {
  if (activity.isArchived) return false;
  if (activity.startDate && activity.startDate > dateKey) return false;
  const schedule = activity.scheduleType || (activity.targetPeriod === "weekly" ? "weekly" : "daily");
  if (schedule === "daily") return true;
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  const days = activity.targetDays || [];
  if (schedule === "custom" || schedule === "weekly") {
    return days.length ? days.includes(weekday) : schedule === "weekly";
  }
  return true;
}

export type ExecutionReviewMetrics = {
  completedTasks: number;
  completionRate: number;
  plannedMinutes: number;
  actualMinutes: number;
  overdueTasks: number;
  habitRate: number;
};

export function executionReviewMetrics(
  tasks: ExecutionTask[],
  activities: Activity[],
  logs: ActivityLog[],
  now = new Date(),
): ExecutionReviewMetrics {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const completed = tasks.filter((task) => task.completedAt && new Date(task.completedAt) >= start);
  const planned = tasks.filter((task) => {
    const value = task.scheduledStartAt || task.dueAt;
    return Boolean(value && new Date(value) >= start);
  });
  const overdue = tasks.filter((task) =>
    isOpenExecutionTask(task) && Boolean(task.dueAt && new Date(task.dueAt).getTime() < now.getTime())
  ).length;
  const plannedMinutes = planned.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
  const actualMinutes = completed.reduce((sum, task) => sum + (task.actualMinutes ?? 0), 0);

  const dateKeys = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const active = activities.filter((activity) => !activity.isArchived);
  const expected = active.reduce(
    (sum, activity) => sum + dateKeys.filter((date) => habitScheduledOnDate(activity, date)).length,
    0,
  );
  const completedKeys = new Set(
    logs
      .filter((log) => log.status !== "skipped")
      .map((log) => `${log.activityId}|${log.createdAt.slice(0, 10)}`)
      .filter((key) => {
        const [activityId, date] = key.split("|");
        const activity = active.find((item) => item.id === activityId);
        return Boolean(activity && dateKeys.includes(date) && habitScheduledOnDate(activity, date));
      }),
  );

  return {
    completedTasks: completed.length,
    completionRate: planned.length ? Math.round(completed.length / planned.length * 100) : 0,
    plannedMinutes,
    actualMinutes,
    overdueTasks: overdue,
    habitRate: expected ? Math.round(completedKeys.size / expected * 100) : 0,
  };
}
