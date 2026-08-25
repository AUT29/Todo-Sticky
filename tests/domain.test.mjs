import assert from "node:assert/strict";
import {
  hiddenDateKeys,
  normalizeState,
  reorderWithinGroup,
  runRollover,
  sortedTasksForDate,
  timelineMatchesQuery,
  visibleDateKeys
} from "../src/domain.js";

const state = {
  version: 1,
  ui: {},
  tasks: [
    { id: "old", title: "old", date: "2026-08-01", priority: "P0", completed: false, order: 1 },
    { id: "done", title: "done", date: "2026-08-01", priority: "P1", completed: true, order: 1 },
    { id: "today-p2", title: "today", date: "2026-08-03", priority: "P2", completed: false, order: 1 },
    { id: "today-p0", title: "today", date: "2026-08-03", priority: "P0", completed: false, order: 1 }
  ],
  ranges: [
    { id: "range-old", title: "range", startDate: "2026-07-28", endDate: "2026-07-30", completed: false, order: 1 },
    { id: "range-live", title: "range", startDate: "2026-08-03", endDate: "2026-08-07", completed: false, order: 2 }
  ],
  timeline: []
};

const rangeLive = runRollover({
  ...state,
  customDates: [{ startDate: "2026-08-03", endDate: "2026-08-07" }],
  tasks: [{ id: "range-task", title: "range", date: "2026-08-03", priority: "P1", completed: false, order: 1 }]
}, "2026-08-05");
assert.equal(rangeLive.tasks[0].date, "2026-08-03");
const rangeDone = runRollover(rangeLive, "2026-08-08");
assert.equal(rangeDone.tasks[0].date, "2026-08-08");
assert.equal(rangeDone.tasks[0].priority, null);
assert.equal(rangeDone.tasks[0].originalDueDate, "2026-08-07");
assert.equal(rangeDone.tasks[0].deferredDays, 1);

const rangeMiddleLive = runRollover({
  ...state,
  customDates: [{ startDate: "2026-08-03", endDate: "2026-08-07" }],
  tasks: [{ id: "range-middle", title: "range", date: "2026-08-04", priority: "P1", completed: false, order: 1 }]
}, "2026-08-05");
assert.equal(rangeMiddleLive.tasks[0].date, "2026-08-04");
const rangeMiddleDone = runRollover(rangeMiddleLive, "2026-08-08");
assert.equal(rangeMiddleDone.tasks[0].date, "2026-08-08");
assert.equal(rangeMiddleDone.tasks[0].originalDueDate, "2026-08-07");

const rolled = runRollover(state, "2026-08-03");
const old = rolled.tasks.find((task) => task.id === "old");
assert.equal(old.date, "2026-08-03");
assert.equal(old.priority, null);
assert.equal(old.deferredDays, 2);

const preservedHistory = runRollover({
  ...state,
  tasks: [{ id: "history-entry", title: "history", date: "2026-08-01", priority: "P2", completed: false, historicalEntry: true }]
}, "2026-08-03");
assert.equal(preservedHistory.tasks[0].date, "2026-08-01");
assert.equal(preservedHistory.tasks[0].priority, "P2");

assert.equal(rolled.tasks.some((task) => task.fromRangeId === "range-old"), false);
assert.equal(rolled.ranges.find((range) => range.id === "range-old").convertedTaskId, undefined);
const sorted = sortedTasksForDate(rolled.tasks, "2026-08-03");
assert.deepEqual(sorted.map((task) => task.id).slice(0, 2), ["today-p0", "today-p2"]);
assert.equal(sorted.at(-1).priority, null);

const reordered = reorderWithinGroup([
  { id: "a", date: "2026-08-03", priority: "P0", order: 1 },
  { id: "b", date: "2026-08-03", priority: "P0", order: 2 }
], "2026-08-03", "P0", "b", "a");
assert.deepEqual(sortedTasksForDate(reordered, "2026-08-03").map((task) => task.id), ["b", "a"]);

const reorderedRange = reorderWithinGroup([
  { id: "a", date: "2026-08-03", priority: "P0", order: 1 },
  { id: "b", date: "2026-08-04", priority: "P0", order: 2 }
], "2026-08-03", "P0", "b", "a", (task) => "2026-08-03" <= task.date && task.date <= "2026-08-07");
assert.deepEqual(reorderedRange.map((task) => [task.id, task.order]), [["a", 2], ["b", 1]]);

const visible = visibleDateKeys({
  ...rolled,
  customDates: ["2026-08-04", "2026-08-05", "2026-08-06"],
  tasks: [
    ...rolled.tasks,
    { id: "past2", date: "2026-08-02" },
    { id: "future1", date: "2026-08-04" },
    { id: "future2", date: "2026-08-05" },
    { id: "future3", date: "2026-08-06" }
  ]
}, "2026-08-03");
assert.deepEqual(visible, ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
assert.ok(hiddenDateKeys({ ...rolled, tasks: [...rolled.tasks, { id: "future3", date: "2026-08-08" }, { id: "future4", date: "2026-08-09" }, { id: "future5", date: "2026-08-10" }] }, "2026-08-03").includes("2026-08-10"));

const rangeVisible = visibleDateKeys({
  version: 1,
  ui: {},
  customDates: [{ startDate: "2026-08-03", endDate: "2026-08-07" }],
  tasks: [{ id: "inside-range", date: "2026-08-04", priority: "P2" }],
  ranges: [],
  timeline: []
}, "2026-08-03");
assert.deepEqual(rangeVisible, ["2026-08-03"]);
assert.deepEqual(hiddenDateKeys({ version: 1, ui: {}, customDates: [{ startDate: "2026-08-03", endDate: "2026-08-07" }], tasks: [{ id: "inside-range", date: "2026-08-04", priority: "P2" }], ranges: [], timeline: [] }, "2026-08-03"), []);


const legacy = normalizeState({ version: 1, ui: {}, customDates: ["2026-08-04"], tasks: [], ranges: [], timeline: [], pet: { mode: "pet" } }, new Date("2026-08-03T09:00:00"));
assert.deepEqual(legacy.customDates, ["2026-08-04"]);
assert.deepEqual(normalizeState({ customDates: [{ startDate: "2026-08-04", endDate: "2026-08-06" }] }).customDates, [{ startDate: "2026-08-04", endDate: "2026-08-06" }]);
const repairedWeekend = normalizeState({
  ui: { activeDate: "2026-08-09" },
  customDates: ["2026-08-08", "2026-08-09"],
  tasks: [{ id: "sun", title: "sun", date: "2026-08-09" }]
});
assert.deepEqual(repairedWeekend.customDates, [{ startDate: "2026-08-08", endDate: "2026-08-09" }]);
assert.equal(repairedWeekend.tasks[0].date, "2026-08-08");
assert.equal(repairedWeekend.ui.activeDate, "2026-08-08");

assert.equal(legacy.ui.historyOpen, false);
assert.equal(legacy.ui.historyMonth, "2026-08");
assert.equal(legacy.ui.historyDate, "2026-08-02");
assert.equal(legacy.sync.provider, "supabase");
assert.equal(legacy.sync.enabled, false);
assert.equal(legacy.sync.supabaseUrl, "");
assert.equal(legacy.sync.supabaseAnonKey, "");
assert.equal(legacy.sync.firstLinkedAt, null);
assert.equal(Object.hasOwn(legacy, "pet"), false);
assert.ok(legacy.sync.localOwnerId.startsWith("local_user_"));
assert.ok(legacy.sync.deviceId.startsWith("device_"));


assert.equal(timelineMatchesQuery({ title: "复盘", summary: "修好了搜索" }, "复盘"), true);
assert.equal(timelineMatchesQuery({ title: "复盘", summary: "修好了搜索" }, "搜索"), true);
assert.equal(timelineMatchesQuery({ title: "复盘", contentHtml: "<p>发布安装包</p>" }, "安装包"), true);
assert.equal(timelineMatchesQuery({ title: "复盘", summary: "修好了搜索" }, "不存在"), false);

console.log("domain tests passed");
