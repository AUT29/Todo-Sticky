export const PRIORITIES = ["P0", "P1", "P2"];
export function todayKey(now = new Date()) {
  return toDateKey(now);
}

export function toDateKey(date) {
  const value = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(key, days) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function diffDays(fromKey, toKey) {
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.max(0, Math.floor((to - from) / 86400000));
}

export function weekdayLabel(key) {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${key}T00:00:00`).getDay()];
}

export function displayDate(key) {
  const date = new Date(`${key}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayLabel(key)}`;
}

export function timelineMatchesQuery(item, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText([item?.title, item?.summary, htmlText(item?.contentHtml)].join(" ")).includes(needle);
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function htmlText(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ");
}

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialState(now = new Date()) {
  return {
    version: 1,
    lastRolloverDate: todayKey(now),
    ui: {
      alwaysOnTop: false,
      showArchive: false,
      activeDate: todayKey(now),
      expandedTaskId: null,
      timelineExpanded: false,
      historyOpen: false,
      historyMonth: todayKey(now).slice(0, 7),
      historyDate: addDays(todayKey(now), -1)
    },
    customDates: [],
    tasks: [],
    ranges: [],
    timeline: [],
    sync: createSyncState(now)
  };
}

export function createSyncState(now = new Date()) {
  return {
    schemaVersion: 1,
    enabled: false,
    provider: "supabase",
    accountId: null,
    accountEmail: null,
    supabaseUrl: "",
    supabaseAnonKey: "",
    accessToken: null,
    refreshToken: null,
    deviceId: makeId("device"),
    localOwnerId: makeId("local_user"),
    firstLinkedAt: null,
    lastPulledAt: null,
    lastPushedAt: null,
    updatedAt: new Date(now).toISOString()
  };
}


export function normalizeState(input, now = new Date()) {
  const base = createInitialState(now);
  const { pet, ...stateInput } = input && typeof input === "object" ? input : {};
  const customDates = normalizeCustomDates(input?.customDates);
  const repaired = repairLegacyWeekendRanges(customDates, Array.isArray(input?.tasks) ? input.tasks : []);
  const ui = { ...base.ui, ...(input?.ui ?? {}) };
  if (repaired.dateMap.has(ui.activeDate)) ui.activeDate = repaired.dateMap.get(ui.activeDate);
  if (repaired.dateMap.has(ui.dateMenuKey)) ui.dateMenuKey = repaired.dateMap.get(ui.dateMenuKey);
  return {
    ...base,
    ...stateInput,
    ui,
    customDates: repaired.customDates,
    tasks: repaired.tasks,
    ranges: Array.isArray(input?.ranges) ? input.ranges : [],
    timeline: Array.isArray(input?.timeline) ? input.timeline : [],
    sync: normalizeSyncState(input?.sync, now)
  };
}

export function normalizeSyncState(input, now = new Date()) {
  const base = createSyncState(now);
  return {
    ...base,
    ...(input && typeof input === "object" ? input : {}),
    schemaVersion: 1,
    provider: "supabase",
    enabled: Boolean(input?.enabled && input?.accountId),
    accountId: input?.accountId || null,
    accountEmail: input?.accountEmail || null,
    supabaseUrl: input?.supabaseUrl || "",
    supabaseAnonKey: input?.supabaseAnonKey || "",
    accessToken: input?.accessToken || null,
    refreshToken: input?.refreshToken || null,
    deviceId: input?.deviceId || base.deviceId,
    localOwnerId: input?.localOwnerId || base.localOwnerId,
    firstLinkedAt: input?.firstLinkedAt || null
  };
}


export function runRollover(input, today = todayKey()) {
  const state = normalizeState(input);
  const tasks = state.tasks.map((task) => {
    const range = rangeForDate(state, task.date);
    if (task.completed || task.historicalEntry || task.date >= today || (range && today <= range.endDate)) return task;
    const baseDate = task.originalDueDate || range?.endDate || task.date;
    return {
      ...task,
      date: today,
      priority: null,
      deferredFrom: task.deferredFrom || task.date,
      originalDueDate: baseDate,
      deferredDays: diffDays(baseDate, today),
      order: Date.now() + Math.random()
    };
  });

  return {
    ...state,
    lastRolloverDate: today,
    tasks,
    ranges: state.ranges
  };
}

export function visibleDateKeys(state, today = todayKey()) {
  const normalized = normalizeState(state);
  const todayRange = rangeForDate(normalized, today);
  const keys = new Set([todayRange ? todayRange.startDate : today]);
  for (const item of normalized.customDates) keys.add(customDateKey(item));
  for (const task of normalized.tasks) keys.add(displayDateKeyForTask(normalized, task));
  const sorted = [...keys].sort();
  const past = sorted.filter((key) => key < today).slice(-2);
  const future = sorted.filter((key) => key > today).slice(0, 2);
  return [...past, todayRange ? todayRange.startDate : today, ...future].filter((key, index, list) => list.indexOf(key) === index);
}

export function hiddenDateKeys(state, today = todayKey()) {
  const normalized = normalizeState(state);
  const visible = new Set(visibleDateKeys(normalized, today));
  const keys = new Set();
  for (const item of normalized.customDates) keys.add(customDateKey(item));
  for (const task of normalized.tasks) keys.add(displayDateKeyForTask(normalized, task));
  return [...keys].filter((key) => !visible.has(key)).sort().reverse();
}

export function sortedTasksForDate(tasks, date) {
  const current = tasks.filter((task) => task.date === date);
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  return current.sort((a, b) => {
    const aRank = a.priority ? priorityOrder[a.priority] : 3;
    const bRank = b.priority ? priorityOrder[b.priority] : 3;
    if (aRank !== bRank) return aRank - bRank;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

export function reorderWithinGroup(tasks, date, group, sourceId, targetId, dateMatches = (task) => task.date === date) {
  const sameGroup = (task) => dateMatches(task) && (task.priority || "DEFERRED") === group;
  const groupItems = tasks.filter(sameGroup).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const from = groupItems.findIndex((task) => task.id === sourceId);
  const to = groupItems.findIndex((task) => task.id === targetId);
  if (from < 0 || to < 0 || from === to) return tasks;
  const [item] = groupItems.splice(from, 1);
  groupItems.splice(to, 0, item);
  const orderById = new Map(groupItems.map((task, index) => [task.id, index + 1]));
  return tasks.map((task) => (orderById.has(task.id) ? { ...task, order: orderById.get(task.id) } : task));
}


function normalizeCustomDates(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object" || !item.startDate) return null;
    const startDate = toDateKey(item.startDate);
    const endDate = item.endDate && item.endDate >= startDate ? toDateKey(item.endDate) : startDate;
    return endDate === startDate ? startDate : { startDate, endDate };
  }).filter(Boolean).filter((item) => {
    const key = customDateKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => customDateKey(a).localeCompare(customDateKey(b)));
}

function repairLegacyWeekendRanges(customDates, tasks) {
  const dateMap = new Map();
  const nextCustomDates = [];
  for (let index = 0; index < customDates.length; index += 1) {
    const item = customDates[index];
    const next = customDates[index + 1];
    if (typeof item === "string" && typeof next === "string" && addDays(item, 1) === next && new Date(`${item}T00:00:00`).getDay() === 6) {
      nextCustomDates.push({ startDate: item, endDate: next });
      dateMap.set(next, item);
      index += 1;
    } else {
      nextCustomDates.push(item);
    }
  }
  if (!dateMap.size) return { customDates, tasks, dateMap };
  return {
    customDates: nextCustomDates,
    tasks: tasks.map((task) => dateMap.has(task.date) ? { ...task, date: dateMap.get(task.date) } : task),
    dateMap
  };
}

export function customDateKey(item) {
  return typeof item === "string" ? item : item.startDate;
}

function displayDateKeyForTask(state, task) {
  const range = rangeForDate(state, task.date);
  return range ? range.startDate : task.date;
}

export function rangeForStart(state, startDate) {
  return (state.customDates || []).find((item) => typeof item === "object" && item.startDate === startDate) || null;
}

export function rangeForDate(state, date) {
  return (state.customDates || []).find((item) => typeof item === "object" && item.startDate <= date && date <= item.endDate) || null;
}
