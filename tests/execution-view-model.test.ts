import assert from "node:assert/strict";
import test from "node:test";
import {
  executionReviewMetrics,
  isExecutionInboxTask,
  normalizeWeekdays,
  preserveTaskUpdateFields,
  resizeScheduledTaskInput,
  scheduleTaskInput,
  shiftScheduledTaskInput,
  waitingToTaskInput,
} from "../src/components/feature/execution/executionViewModel";

const task = {
  id: "t1",
  userId: "local",
  title: "Task",
  status: "todo" as const,
  priority: "normal" as const,
  actualMinutes: 42,
  scheduledStartAt: "2026-08-09T02:00:00.000Z",
  scheduledEndAt: "2026-08-09T03:00:00.000Z",
  timezone: "Asia/Shanghai",
  version: 1,
  createdAt: "2026-08-09T00:00:00Z",
  updatedAt: "2026-08-09T00:00:00Z",
};

test("task edit preserves fields not exposed by the basic editor", () => {
  const result = preserveTaskUpdateFields(task, { title: "Renamed", priority: "high" });
  assert.equal(result.actualMinutes, 42);
  assert.equal(result.scheduledStartAt, task.scheduledStartAt);
  assert.equal(result.scheduledEndAt, task.scheduledEndAt);
  assert.equal(result.timezone, "Asia/Shanghai");
});

test("waiting conversion resolves the source and carries expected time", () => {
  const result = waitingToTaskInput({
    id: "w1",
    userId: "local",
    title: "Wait for Alice",
    status: "open",
    waitingFor: "Alice",
    expectedAt: "2026-08-10T00:00:00Z",
    version: 1,
    createdAt: "2026-08-09T00:00:00Z",
    updatedAt: "2026-08-09T00:00:00Z",
  });
  assert.equal(result.resolveSource, true);
  assert.equal(result.dueAt, "2026-08-10T00:00:00Z");
  assert.equal(result.context, "等待：Alice");
});

test("weekday normalization removes duplicates and invalid values", () => {
  assert.deepEqual(normalizeWeekdays([7, 5, 1, 1, 9, -1, 0]), [1, 5, 7]);
});


test("inbox classifier only includes unorganized open tasks", () => {
  assert.equal(isExecutionInboxTask(task), true);
  assert.equal(isExecutionInboxTask({ ...task, projectId: "p1" }), false);
  assert.equal(isExecutionInboxTask({ ...task, dueAt: "2026-08-10T00:00:00Z" }), false);
  assert.equal(isExecutionInboxTask({ ...task, scheduledStartAt: "2026-08-10T00:00:00Z" }), false);
  assert.equal(isExecutionInboxTask({ ...task, status: "done" }), false);
});

test("planner schedule, move and resize preserve task fields", () => {
  const scheduled = scheduleTaskInput(task, "2026-08-09T10:00:00Z", 60);
  assert.equal(scheduled.scheduledStartAt, "2026-08-09T10:00:00.000Z");
  assert.equal(scheduled.scheduledEndAt, "2026-08-09T11:00:00.000Z");
  assert.equal(scheduled.actualMinutes, 42);

  const moved = shiftScheduledTaskInput({
    ...task,
    scheduledStartAt: scheduled.scheduledStartAt,
    scheduledEndAt: scheduled.scheduledEndAt,
    estimatedMinutes: 60,
  }, 15);
  assert.equal(moved.scheduledStartAt, "2026-08-09T10:15:00.000Z");
  assert.equal(moved.scheduledEndAt, "2026-08-09T11:15:00.000Z");

  const resized = resizeScheduledTaskInput({
    ...task,
    scheduledStartAt: scheduled.scheduledStartAt,
    scheduledEndAt: scheduled.scheduledEndAt,
    estimatedMinutes: 60,
  }, -15);
  assert.equal(resized.estimatedMinutes, 45);
  assert.equal(resized.scheduledEndAt, "2026-08-09T10:45:00.000Z");
});

test("execution review combines task and habit performance", () => {
  const now = new Date("2026-08-10T12:00:00Z");
  const metrics = executionReviewMetrics(
    [
      {
        ...task,
        id: "done",
        status: "done",
        dueAt: "2026-08-09T23:00:00Z",
        completedAt: "2026-08-09T10:00:00Z",
        estimatedMinutes: 60,
        actualMinutes: 50,
      },
      {
        ...task,
        id: "overdue",
        dueAt: "2026-08-08T12:00:00Z",
        estimatedMinutes: 30,
        actualMinutes: null,
      },
    ],
    [{
      id: "habit-1",
      userId: "local",
      name: "Read",
      type: "completion",
      unit: "次",
      normalTarget: 1,
      targetPeriod: "daily",
      scheduleType: "daily",
      isArchived: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }],
    [{
      id: "log-1",
      userId: "local",
      activityId: "habit-1",
      value: 1,
      status: "completed",
      createdAt: "2026-08-09T08:00:00Z",
      updatedAt: "2026-08-09T08:00:00Z",
    }],
    now,
  );
  assert.equal(metrics.completedTasks, 1);
  assert.equal(metrics.plannedMinutes, 90);
  assert.equal(metrics.actualMinutes, 50);
  assert.equal(metrics.overdueTasks, 1);
  assert.equal(metrics.habitRate, 14);
});
