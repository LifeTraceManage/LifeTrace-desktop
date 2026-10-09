import assert from "node:assert/strict";
import test from "node:test";
import { calendarItemsWithTasks, calendarRange, eventsForDay } from "../src/components/feature/execution/calendarViewModel";
import type { CalendarEvent, ExecutionTask } from "../src/services/executionApi";

const day = new Date(2026, 10, 18);
const range = calendarRange("month", day);
const start = new Date(2026, 10, 18, 10, 30);
const end = new Date(2026, 10, 18, 11, 30);
const task: ExecutionTask = {
  id: "scheduled-1", userId: "local", title: "未来的任务",
  status: "todo", priority: "normal", scheduledStartAt: start.toISOString(),
  scheduledEndAt: end.toISOString(), version: 1,
  createdAt: start.toISOString(), updatedAt: start.toISOString(),
};

test("scheduled future task appears as a timed calendar item", () => {
  const items = calendarItemsWithTasks([], [task], range);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "planned-task:scheduled-1");
  assert.equal(items[0].isAllDay, false);
  assert.deepEqual(eventsForDay(items, day).map(item => item.id), ["planned-task:scheduled-1"]);
});

test("linked calendar event prevents rendering a duplicate task block", () => {
  const event: CalendarEvent = {
    id: "cal-1", userId: "local", title: "已关联",
    status: "scheduled", isAllDay: false, sourceTaskId: task.id,
    startAt: start.toISOString(), endAt: end.toISOString(),
    version: 1, createdAt: start.toISOString(), updatedAt: start.toISOString(),
  };
  assert.deepEqual(calendarItemsWithTasks([event], [task], range).map(item => item.id), ["cal-1"]);
});

test("deadline-only task is separate all-day marker, while completed tasks are absent", () => {
  const dueOnly = { ...task, id: "due", scheduledStartAt: null, scheduledEndAt: null, dueAt: end.toISOString() };
  const items = calendarItemsWithTasks([], [dueOnly, { ...task, id: "done", status: "done" }], range);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "deadline-task:due");
  assert.equal(items[0].isAllDay, true);
  assert.match(items[0].title, /^截止/);
});

test("a scheduled task with a separate deadline shows both entries", () => {
  const twoDaysLater = new Date(2026, 10, 20, 18);
  const items = calendarItemsWithTasks([], [{ ...task, dueAt: twoDaysLater.toISOString() }], range);
  assert.deepEqual(items.map(item => item.id), ["planned-task:scheduled-1", "deadline-task:scheduled-1"]);
  assert.deepEqual(eventsForDay(items, twoDaysLater).map(item => item.id), ["deadline-task:scheduled-1"]);
});

test("tasks outside visible date range are not rendered", () => {
  const far = { ...task, scheduledStartAt: new Date(2027, 0, 1).toISOString(), scheduledEndAt: new Date(2027, 0, 1, 1).toISOString() };
  assert.equal(calendarItemsWithTasks([], [far], range).length, 0);
});
