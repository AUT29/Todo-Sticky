import {
  PRIORITIES,
  addDays,
  createInitialState,
  displayDate,
  customDateKey,
  hiddenDateKeys,
  makeId,
  normalizeState,
  reorderWithinGroup,
  runRollover,
  sortedTasksForDate,
  todayKey,
  toDateKey,
  visibleDateKeys,
  rangeForStart,
  timelineMatchesQuery,
  weekdayLabel
} from "./domain.js";
import { BUILTIN_SUPABASE_ANON_KEY, BUILTIN_SUPABASE_URL } from "./cloud-config.js";

const STORAGE_KEY = "daibanshixiang.state.v1";
const FILE_DB = "daibanshixiang.files";
const FILE_STORE = "files";
const GROUPS = ["P0", "P1", "P2", "DEFERRED"];
const GROUP_LABELS = { P0: "P0", P1: "P1", P2: "P2", DEFERRED: "拖延队列" };
const SUPABASE_REST_TIMEOUT_MS = 15000;
const CLOUD_PUSH_DEBOUNCE_MS = 2500;
const app = document.querySelector("#app");
let state = resetStartupUi(runRollover(seedState(), todayKey()));
let draggedTask = null;
let pointerDrag = null;
const titleEditOriginals = new Map();
let modalState = null;
let cloudPushTimer = null;
let suppressCloudPush = false;
let cloudSyncRunning = false;
let nativeSaveQueue = Promise.resolve();
const imageSrcByFileId = new Map();
const NOTE_WINDOW_WIDTH = 380;
const TIMELINE_WINDOW_WIDTH = 760;
const TIMELINE_AUTOSAVE_DELAY_MS = 1000;
let timelineRestoreWidth = null;
let timelineAutosaveTimer = null;
let timelineSearch = "";

startApp();

async function startApp() {
  state = resetStartupUi(runRollover(await loadState(), todayKey()));
  saveStateWithoutCloudPush();
  render();
  await repairNativeAttachmentsFromIndexedDb();
  scheduleStartupSync();
}

async function loadState() {
  return newestState(await loadNativeState(), loadBrowserState()) || seedState();
}

function loadBrowserState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function loadNativeState() {
  try {
    const raw = await invokeWindow("load_app_state");
    return raw ? normalizeState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function newestState(left, right) {
  if (!left) return right;
  if (!right) return left;
  return stateTimestamp(right) > stateTimestamp(left) ? right : left;
}

function stateTimestamp(value) {
  const dates = [
    value?.sync?.updatedAt,
    value?.sync?.lastPushedAt,
    ...(Array.isArray(value?.tasks) ? value.tasks.flatMap((item) => [item.updatedAt, item.createdAt]) : []),
    ...(Array.isArray(value?.timeline) ? value.timeline.flatMap((item) => [item.updatedAt, item.createdAt]) : [])
  ];
  return Math.max(0, ...dates.map((date) => Date.parse(date || "") || 0));
}

function resetStartupUi(input) {
  return {
    ...input,
    ui: {
      ...input.ui,
      timelineOpen: false,
      editingTimelineId: null,
      historyOpen: false
    }
  };
}

function seedState() {
  return createInitialState();
}

function makeTask(input) {
  return {
    id: makeId("task"),
    title: "",
    detail: "",
    date: todayKey(),
    priority: "P2",
    completed: false,
    deferredDays: 0,
    order: Date.now(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input
  };
}

function saveState() {
  const value = JSON.stringify(state);
  queueNativeStateSave(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (error) {
    console.warn("localStorage save failed", error);
  }
  scheduleCloudPush();
}

function queueNativeStateSave(value) {
  nativeSaveQueue = nativeSaveQueue
    .catch(() => {})
    .then(() => invokeWindow("save_app_state", { value }))
    .catch((error) => console.warn("AppData save failed", error));
}

function update(mutator, options = {}) {
  state = touchSyncUpdated(mutator(state));
  saveState();
  if (options.render !== false) render();
}

function touchSyncUpdated(nextState) {
  if (!nextState?.sync) return nextState;
  return { ...nextState, sync: { ...nextState.sync, updatedAt: new Date().toISOString() } };
}

function saveStateWithoutCloudPush() {
  suppressCloudPush = true;
  try {
    saveState();
  } finally {
    suppressCloudPush = false;
  }
}

function canCloudSync() {
  const sync = state.sync || {};
  return Boolean(sync.enabled && sync.accountId && (sync.accessToken || sync.refreshToken) && sync.supabaseUrl && sync.supabaseAnonKey);
}

function scheduleStartupSync() {
  if (!canCloudSync()) return;
  setTimeout(() => syncStateWithSupabase({ silent: true }).catch((error) => console.warn("Startup sync failed", error)), 800);
}

function scheduleCloudPush() {
  if (suppressCloudPush || !canCloudSync()) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    if (cloudSyncRunning) {
      scheduleCloudPush();
      return;
    }
    pushStateToSupabase({ silent: true }).catch((error) => console.warn("Cloud push failed", error));
  }, CLOUD_PUSH_DEBOUNCE_MS);
}


function render() {
  const shell = app.querySelector(".shell");
  const historyBody = app.querySelector(".history-view-body");
  const historyContext = app.querySelector("[data-history-context]")?.dataset.historyContext || null;
  const historyScrollTop = historyBody?.scrollTop ?? 0;
  const scrollTop = shell?.scrollTop ?? 0;
  const today = todayKey();
  const dates = visibleDateKeys(state, today);
  app.classList.toggle("timeline-open", Boolean(state.ui.timelineOpen));
  app.innerHTML = `
    <main class="shell">
      <header class="titlebar" data-window-drag>
        <div class="mascot" aria-hidden="true"><span></span></div>
        <div class="titlecopy">
          <div class="titleline"><div class="titletext"><strong>\u5f85\u529e\u5c0f\u4fbf\u7b7e</strong><small>${displayDate(today)}</small></div><div class="title-tools" aria-label="\u5de5\u5177"><button class="title-tool account" data-action="open-account" title="\u8d26\u53f7\u540c\u6b65"><span>@</span>\u8d26\u53f7</button><button class="title-tool timeline ${state.ui.timelineOpen ? "active" : ""}" data-action="toggle-timeline" title="\u65f6\u95f4\u8f74\u603b\u7ed3"><span>\u8f74</span>\u65f6\u95f4\u8f74</button></div></div>
        </div>        <div class="window-actions">
          <button class="icon-btn ${state.ui.alwaysOnTop ? "active" : ""}" data-action="toggle-top" title="切换置顶">◆</button>
          <button class="icon-btn" data-action="minimize" title="收起">-</button>
          <button class="icon-btn danger" data-action="close" title="退出">×</button>
        </div>
      </header>


      <nav class="date-strip">
        ${dates.map((date) => renderDateChip(date, today)).join("")}
        <button class="date-chip add-date" data-action="add-date">+ 日期</button>
        <button class="date-chip more" data-action="toggle-history">\u66f4\u591a</button>
      </nav>
      ${renderDateBlockMenu()}

      <section class="content">
        ${dates.map((date) => renderDatePanel(date)).join("")}
      </section>
    </main>
    ${state.ui.timelineOpen ? renderTimelinePanel() : ""}
    ${state.ui.historyOpen ? renderHistoryView() : ""}
    ${modalState ? renderModal() : ""}
  `;
  bindEvents();
  pruneImagePreviewCache();
  const nextShell = app.querySelector(".shell");
  if (nextShell) nextShell.scrollTop = scrollTop;
  const nextHistoryView = app.querySelector("[data-history-context]");
  const nextHistoryBody = app.querySelector(".history-view-body");
  if (nextHistoryBody && historyContext && nextHistoryView?.dataset.historyContext === historyContext) {
    nextHistoryBody.scrollTop = historyScrollTop;
  }
}

function renderDateChip(date, today) {
  const range = rangeForStart(state, date);
  const active = state.ui.activeDate === date ? "active" : "";
  const tone = date < today ? "past" : date > today ? "future" : "today";
  const weekend = isWeekend(date) ? "weekend" : "weekday";
  return `<button class="date-chip ${active} ${tone} ${weekend} ${range ? "range" : ""}" data-action="select-date" data-date="${date}" data-date-chip="${date}">
    <span>${range ? "时间段" : weekdayLabel(date)}${date === today ? `<em>今天</em>` : ""}</span><b>${range ? rangeChipLabel(range) : dateChipLabel(date)}</b>
  </button>`;
}

function renderDateBlockMenu() {
  const date = state.ui.dateMenuKey;
  if (!date || !customBlock(date)) return "";
  return `<div class="date-menu"><button data-action="delete-date-block" data-date="${date}">删除</button></div>`;
}

function dateChipLabel(date) {
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function rangeChipLabel(range) {
  return `${dateChipLabel(range.startDate)}-${dateChipLabel(range.endDate)}`;
}

function isWeekend(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function renderHistoryView() {
  const month = normalizeHistoryMonth(state.ui.historyMonth);
  const selectedDate = historySelectedDate(month);
  const cells = historyMonthCells(month);
  const taskDates = new Set(state.tasks.flatMap((task) => [task.date, task.originalDueDate].filter(Boolean)));
  const tasks = historyTasksForDate(state.tasks, selectedDate);
  return `<section class="history-view" data-history-context="${month}:${selectedDate}" role="dialog" aria-label="\u5386\u53f2\u8ba1\u5212">
    <header class="history-view-title">
      <strong>\u5386\u53f2\u8ba1\u5212</strong>
      <button data-action="toggle-history" title="\u5173\u95ed">\u00d7</button>
    </header>
    <div class="history-view-body">
      <div class="history-month-controls">
        <button data-action="history-prev-month" title="\u4e0a\u4e00\u4e2a\u6708">\u2039</button>
        <input data-history-month type="month" value="${month}" max="${latestHistoryMonth()}" aria-label="\u9009\u62e9\u6708\u4efd">
        <button data-action="history-next-month" title="\u4e0b\u4e00\u4e2a\u6708" ${month >= latestHistoryMonth() ? "disabled" : ""}>\u203a</button>
      </div>
      <div class="history-weekdays" aria-hidden="true">
        ${["\u65e5", "\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d"].map((label) => `<span>${label}</span>`).join("")}
      </div>
      <div class="history-calendar">
        ${cells.map((date) => date ? renderHistoryDayButton(date, selectedDate, taskDates.has(date)) : `<span class="history-day blank"></span>`).join("")}
      </div>
      <section class="history-day-plan">
        <div class="panel-head">
          <h1>${historyDateLabel(selectedDate)}</h1>
          <button data-action="add-task" data-date="${selectedDate}">\u6dfb\u52a0</button>
        </div>
        ${GROUPS.map((group) => renderTaskGroup(selectedDate, group, tasks.filter((task) => (task.priority || "DEFERRED") === group))).join("")}
      </section>
    </div>
  </section>`;
}

function historyTasksForDate(tasks, date) {
  const matching = tasks
    .filter((task) => task.date === date || task.originalDueDate === date)
    .map((task) => task.date === date ? task : { ...task, date });
  return sortedTasksForDate(matching, date);
}
function renderHistoryDayButton(date, selectedDate, hasTasks) {
  const day = Number(date.slice(8));
  const disabled = date >= todayKey();
  const classes = ["history-day", date === selectedDate ? "selected" : "", hasTasks ? "has-tasks" : "", isWeekend(date) ? "weekend" : ""].filter(Boolean).join(" ");
  return `<button class="${classes}" data-action="select-history-date" data-date="${date}" ${disabled ? "disabled" : ""}>${day}</button>`;
}

function historyMonthCells(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const cells = Array(firstDay).fill(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return cells;
}

function latestHistoryMonth() {
  return addDays(todayKey(), -1).slice(0, 7);
}

function normalizeHistoryMonth(value) {
  const fallback = latestHistoryMonth();
  if (!/^\d{4}-\d{2}$/.test(value || "")) return fallback;
  return value > fallback ? fallback : value;
}

function historySelectedDate(month) {
  const selected = state.ui.historyDate;
  if (selected && selected < todayKey() && selected.startsWith(`${month}-`)) return selected;
  return historyDefaultDateForMonth(month);
}

function historyDefaultDateForMonth(month) {
  const latestDate = addDays(todayKey(), -1);
  if (latestDate.startsWith(`${month}-`)) return latestDate;
  const [year, monthNumber] = month.split("-").map(Number);
  return toDateKey(new Date(year, monthNumber, 0));
}

function historyDateLabel(date) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })
    .format(new Date(`${date}T00:00:00`));
}
function renderDatePanel(date) {
  const range = rangeForStart(state, date);
  const tasks = tasksForDatePanel(date, range);
  const active = state.ui.activeDate === date ? "" : "hidden-panel";
  return `<article class="date-panel ${active}" data-date-panel="${date}">
    <div class="panel-head">
      <h1>${range ? `${displayDate(range.startDate)} - ${displayDate(range.endDate)}` : displayDate(date)}</h1>
      <button data-action="add-task" data-date="${date}">添加</button>
    </div>
    ${GROUPS.map((group) => renderTaskGroup(date, group, tasks.filter((task) => (task.priority || "DEFERRED") === group))).join("")}
  </article>`;
}

function tasksForDatePanel(date, range) {
  if (!range) return sortedTasksForDate(state.tasks, date);
  const tasks = state.tasks
    .filter((task) => dateInBlock(task.date, range))
    .map((task) => ({ ...task, date }));
  return sortedTasksForDate(tasks, date);
}

function renderTaskGroup(date, group, tasks) {
  const empty = tasks.length ? "" : `<div class="drop-empty">拖到这里设为 ${GROUP_LABELS[group]}</div>`;
  return `<div class="task-group" data-drop-date="${date}" data-drop-group="${group}">
    <div class="group-title ${group.toLowerCase()}">${GROUP_LABELS[group]}</div>
    ${tasks.map((task) => renderTask(task, date, group)).join("")}
    ${empty}
  </div>`;
}

function renderTask(task, date, group) {
  const expanded = state.ui.expandedTaskId === task.id;
  return `<article class="task ${task.completed ? "done" : ""} ${task.priority ? task.priority.toLowerCase() : "deferred"}"
    data-task-id="${task.id}" data-date="${date}" data-group="${group}">
    <div class="task-row">
      <button class="drag-handle" data-drag-handle title="拖动排序">::</button>
      <button class="check" data-action="toggle-task" data-id="${task.id}">${task.completed ? "&#10003;" : ""}</button>
      <div class="task-title">
        <span class="task-title-text" data-title-id="${task.id}" contenteditable="plaintext-only" role="textbox" aria-label="编辑待办标题" spellcheck="false">${escapeHtml(task.title)}</span>
        ${task.deferredDays ? `<em>已拖 ${task.deferredDays} 天</em>` : ""}
      </div>
      <button class="tiny" data-action="toggle-detail" data-id="${task.id}" title="\u586b\u5199\u8be6\u60c5">&#9998;</button>
      <button class="tiny danger" data-action="delete-task" data-id="${task.id}" title="删除">×</button>
    </div>
    ${expanded ? `<div class="details">
      <div class="rich-editor" data-rich-kind="task-detail" data-detail-id="${task.id}" contenteditable="true" role="textbox" aria-label="\u8be6\u7ec6\u60c5\u51b5" data-placeholder="\u8be6\u7ec6\u60c5\u51b5..." spellcheck="false">${task.detailHtml || richTextFromPlain(task.detail || "")}</div>
      <div class="detail-actions">
        <button data-action="save-detail" data-id="${task.id}">\u4fdd\u5b58\u8be6\u60c5</button>
      </div>
    </div>` : ""}  </article>`;
}


function renderTimelinePanel() {
  const editingId = state.ui.editingTimelineId;
  const editingItem = editingId === "new" ? null : state.timeline.find((item) => item.id === editingId);
  return `<aside class="timeline-panel" role="dialog" aria-label="\u65f6\u95f4\u8f74\u603b\u7ed3">
    <header class="timeline-panel-title">
      <strong>\u65f6\u95f4\u8f74\u603b\u7ed3</strong>
      <div>
        ${editingId ? `<button data-action="back-timeline-edit" title="\u8fd4\u56de">\u8fd4\u56de</button>` : ""}
        <button data-action="add-timeline-inline" title="\u6dfb\u52a0">+</button>
        <button data-action="toggle-timeline" title="\u6536\u56de">\u00d7</button>
      </div>
    </header>
    <div class="timeline-panel-body">
      ${editingId ? renderTimelineEditor(editingItem) : renderTimelineList()}
    </div>
  </aside>`;
}

function renderTimelineList() {
  if (!state.timeline.length) return `<p class="empty timeline-empty">\u7ed9\u67d0\u5929\u6216\u67d0\u6bb5\u65f6\u95f4\u5199\u4e00\u6761\u603b\u7ed3\u3002</p>`;
  const items = state.timeline
    .slice()
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))
    .filter((item) => timelineMatchesQuery(item, timelineSearch));
  return `<label class="timeline-search">
      <span>\u641c\u7d22</span>
      <input data-timeline-search value="${escapeHtml(timelineSearch)}" placeholder="\u641c\u6807\u9898\u6216\u5185\u5bb9" />
    </label>
    <div data-timeline-list>
      ${renderTimelineItems(items)}
    </div>`;
}

function renderTimelineItems(items) {
  if (!items.length) return `<p class="empty timeline-empty">\u6ca1\u6709\u5339\u914d\u7684\u65f6\u95f4\u8f74\u3002</p>`;
  return items
    .map((item) => `<article class="timeline-item panel-item" data-action="edit-timeline" data-id="${item.id}">
      <div class="timeline-item-head">
        <strong>${escapeHtml(item.title || "\u672a\u547d\u540d\u65f6\u95f4\u8f74")}</strong>
        <button class="icon-delete" data-action="delete-timeline" data-id="${item.id}" title="\u5220\u9664" aria-label="\u5220\u9664">\u00d7</button>
      </div>
      <small>${displayDate(item.startDate)}${item.endDate && item.endDate !== item.startDate ? ` - ${displayDate(item.endDate)}` : ""}</small>
      <div class="timeline-preview rich-preview">${timelinePreviewHtml(item)}</div>
    </article>`)
    .join("");
}

function renderTimelineEditor(item) {
  const isNew = !item;
  const startDate = item?.startDate || todayKey();
  const endDate = item?.endDate || startDate;
  return `<section class="timeline-editor" data-timeline-editor="${item?.id || "new"}">
    <div class="timeline-editor-top">
      <span data-timeline-save-status>\u81ea\u52a8\u4fdd\u5b58\u5df2\u5f00\u542f</span>
    </div>
    <label><span>\u6807\u9898</span><input data-timeline-title value="${escapeHtml(item?.title || "")}" placeholder="\u603b\u7ed3\u6807\u9898" /></label>
    <div class="timeline-editor-dates">
      <label><span>\u5f00\u59cb</span><input data-timeline-start type="date" value="${escapeHtml(startDate)}" /></label>
      <label><span>\u7ed3\u675f</span><input data-timeline-end type="date" value="${escapeHtml(endDate)}" /></label>
    </div>
    <div class="rich-editor timeline-rich" data-rich-kind="timeline" contenteditable="true" role="textbox" aria-label="\u65f6\u95f4\u8f74\u5185\u5bb9" spellcheck="false">${item?.contentHtml || richTextFromPlain(item?.summary || "")}</div>
    <div class="timeline-editor-actions">
      <button data-action="save-timeline-inline" data-id="${item?.id || "new"}">${isNew ? "\u6dfb\u52a0" : "\u4fdd\u5b58"}</button>
    </div>
  </section>`;
}

function timelinePreviewHtml(item) {
  const html = item.contentHtml || richTextFromPlain(item.summary || "");
  return html || `<span class="muted">\u6682\u65e0\u5185\u5bb9</span>`;
}
function renderModal() {
  const fields = modalState.fields || [];
  return `<div class="modal-backdrop" role="presentation">
    <section class="pixel-modal" role="dialog" aria-modal="true">
      <header><strong>${escapeHtml(modalState.title)}</strong><button data-modal-cancel>×</button></header>
      ${modalState.message ? `<p class="modal-message">${escapeHtml(modalState.message)}</p>` : ""}
      <form class="modal-form">
        ${fields.map(renderField).join("")}
        <div class="modal-actions">
          <button type="button" data-modal-cancel>${modalState.cancelText || "取消"}</button>
          <button type="submit" class="primary">${modalState.okText || "确定"}</button>
        </div>
      </form>
    </section>
  </div>`;
}

function renderField(field) {
  const value = escapeHtml(field.value ?? "");
  if (field.type === "select") {
    return `<label class="modal-field"><span>${escapeHtml(field.label)}</span><select name="${field.name}">
      ${(field.options || []).map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === field.value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select></label>`;
  }
  if (field.type === "textarea") {
    return `<label class="modal-field"><span>${escapeHtml(field.label)}</span><textarea name="${field.name}" placeholder="${escapeHtml(field.placeholder || "")}">${value}</textarea></label>`;
  }
  return `<label class="modal-field"><span>${escapeHtml(field.label)}</span><input name="${field.name}" type="${field.type || "text"}" value="${value}" placeholder="${escapeHtml(field.placeholder || "")}" /></label>`;
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((node) => node.addEventListener("click", handleAction));
  app.querySelectorAll("[data-modal-cancel]").forEach((node) => node.addEventListener("click", () => closeModal(null)));
  const form = app.querySelector(".modal-form");
  if (form) form.addEventListener("submit", submitModal);
  app.querySelectorAll("[data-title-id]").forEach((node) => {
    node.addEventListener("focus", beginTitleEdit);
    node.addEventListener("blur", finishTitleEdit);
    node.addEventListener("keydown", handleTitleEditKeydown);
  });
  app.querySelectorAll("[data-detail-id]").forEach((node) => node.addEventListener("blur", () => saveDetail(node.dataset.detailId, { render: false })));
  app.querySelector("[data-history-month]")?.addEventListener("change", (event) => setHistoryMonth(event.currentTarget.value));
  app.querySelector("[data-timeline-search]")?.addEventListener("input", filterTimelineList);
  app.querySelectorAll(".rich-editor").forEach(bindRichEditor);
  bindTimelineAutosave();
  hydrateRichImages();
  app.querySelectorAll("img[data-file-id]").forEach((image) => {
    image.addEventListener("click", stopImageClickPropagation);
    image.addEventListener("dblclick", openImageFromElement);
  });
  app.querySelector("[data-window-drag]")?.addEventListener("pointerdown", startWindowDrag);
  app.querySelectorAll("[data-date-chip]").forEach((node) => node.addEventListener("contextmenu", openDateMenu));
  bindDragEvents();
}


function filterTimelineList(event) {
  timelineSearch = event.currentTarget.value;
  const list = app.querySelector("[data-timeline-list]");
  if (!list) return;
  const items = state.timeline
    .slice()
    .sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""))
    .filter((item) => timelineMatchesQuery(item, timelineSearch));
  list.innerHTML = renderTimelineItems(items);
  list.querySelectorAll("[data-action]").forEach((node) => node.addEventListener("click", handleAction));
  hydrateRichImages();
}

function bindDragEvents() {
  app.querySelectorAll("[data-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", beginPointerTaskDrag);
  });
}

function beginPointerTaskDrag(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const taskNode = event.currentTarget.closest("[data-task-id]");
  if (!taskNode) return;
  pointerDrag = {
    id: taskNode.dataset.taskId,
    date: taskNode.dataset.date,
    group: taskNode.dataset.group,
    startX: event.clientX,
    startY: event.clientY,
    overTaskId: null,
    overGroup: null,
    moved: false
  };
  draggedTask = pointerDrag;
  taskNode.classList.add("dragging");
  document.body.classList.add("task-dragging");
  window.addEventListener("pointermove", movePointerTaskDrag, true);
  window.addEventListener("pointerup", endPointerTaskDrag, true);
}

function movePointerTaskDrag(event) {
  if (!pointerDrag) return;
  const deltaX = event.clientX - pointerDrag.startX;
  const deltaY = event.clientY - pointerDrag.startY;
  if (!pointerDrag.moved && Math.hypot(deltaX, deltaY) < 4) return;
  pointerDrag.moved = true;
  app.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const taskNode = target?.closest?.("[data-task-id]");
  const groupNode = target?.closest?.("[data-drop-date]");
  if (taskNode && taskNode.dataset.date === pointerDrag.date && taskNode.dataset.taskId !== pointerDrag.id) {
    pointerDrag.overTaskId = taskNode.dataset.taskId;
    pointerDrag.overGroup = taskNode.dataset.group;
    taskNode.classList.add("drag-over");
    return;
  }
  if (groupNode && groupNode.dataset.dropDate === pointerDrag.date) {
    pointerDrag.overTaskId = null;
    pointerDrag.overGroup = groupNode.dataset.dropGroup;
    groupNode.classList.add("drag-over");
  }
}

function endPointerTaskDrag() {
  if (!pointerDrag) return;
  const { id, date, overGroup, overTaskId, moved } = pointerDrag;
  app.querySelectorAll(".dragging, .drag-over").forEach((item) => item.classList.remove("dragging", "drag-over"));
  document.body.classList.remove("task-dragging");
  window.removeEventListener("pointermove", movePointerTaskDrag, true);
  window.removeEventListener("pointerup", endPointerTaskDrag, true);
  pointerDrag = null;
  draggedTask = null;
  if (!moved || !overGroup) return;
  const task = state.tasks.find((item) => item.id === id);
  const currentGroup = task?.priority || "DEFERRED";
  if (!overTaskId && overGroup === currentGroup) return;
  moveTask(id, date, overGroup, overTaskId);
}

function moveTask(id, date, group, overTaskId) {
  update((s) => {
    const task = s.tasks.find((item) => item.id === id);
    if (!task) return s;
    const block = customBlock(date) || date;
    const dateMatches = (item) => dateInBlock(item.date, block);
    const nextPriority = group === "DEFERRED" ? null : group;
    let tasks = s.tasks.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        priority: nextPriority,
        updatedAt: new Date().toISOString(),
        order: overTaskId
          ? item.order
          : nextOrder(s.tasks.filter((other) => other.id !== id), date, group, dateMatches)
      };
    });
    if (overTaskId) {
      tasks = reorderWithinGroup(tasks, date, group, id, overTaskId, dateMatches);
    }
    return { ...s, tasks };
  });
}

function startWindowDrag(event) {
  if (event.button !== 0 || event.target.closest("button, input, select, textarea")) return;
  event.preventDefault();
  invokeWindow("start_dragging");
}
async function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "delete-date-block" || action === "delete-timeline") event.stopPropagation();
  const dataset = event.currentTarget.dataset;
  if (action === "select-date") update((s) => ({ ...s, ui: { ...s.ui, activeDate: dataset.date, dateMenuKey: null } }));
  if (action === "toggle-archive") update((s) => ({ ...s, ui: { ...s.ui, showArchive: !s.ui.showArchive } }));
  if (action === "toggle-history") await toggleHistoryView();
  if (action === "history-prev-month") shiftHistoryMonth(-1);
  if (action === "history-next-month") shiftHistoryMonth(1);
  if (action === "select-history-date") selectHistoryDate(dataset.date);
  if (action === "toggle-timeline") await toggleTimelinePanel();
  if (action === "add-timeline-inline") startTimelineEdit("new");
  if (action === "edit-timeline") startTimelineEdit(dataset.id);
  if (action === "back-timeline-edit") returnToTimelineList();
  if (action === "cancel-timeline-edit") returnToTimelineList();
  if (action === "save-timeline-inline") saveTimelineInline(dataset.id);
  if (action === "delete-timeline") await deleteTimeline(dataset.id);
  if (action === "open-account") await openAccountSettings();
  if (action === "add-date") await addFutureDate();
  if (action === "delete-date-block") await deleteDateBlock(dataset.date);
  if (action === "add-task") await addTaskForDate(dataset.date);
  if (action === "toggle-task") toggleTask(dataset.id);
  if (action === "toggle-detail") toggleDetail(dataset.id);
  if (action === "delete-task") await deleteTask(dataset.id);
  if (action === "save-detail") saveDetail(dataset.id);
  if (action === "download-file") await downloadAttachment(dataset.fileId);
  if (action === "toggle-top") await toggleAlwaysOnTop();
  if (action === "minimize") await invokeWindow("minimize");
  if (action === "close") await closeApp();
}

function configuredSupabaseUrl(sync = state.sync || {}) {
  return (BUILTIN_SUPABASE_URL || sync.supabaseUrl || "").trim().replace(/\/$/, "");
}

function configuredSupabaseAnonKey(sync = state.sync || {}) {
  return (BUILTIN_SUPABASE_ANON_KEY || sync.supabaseAnonKey || "").trim();
}

function hasBuiltinSupabaseConfig() {
  return Boolean(BUILTIN_SUPABASE_URL && BUILTIN_SUPABASE_ANON_KEY);
}

async function openAccountSettings() {
  const sync = state.sync || {};
  const configFields = hasBuiltinSupabaseConfig() ? [] : [
    { name: "supabaseUrl", label: "Supabase URL", value: sync.supabaseUrl || "", placeholder: "https://xxxx.supabase.co" },
    { name: "supabaseAnonKey", label: "Anon Key", value: sync.supabaseAnonKey || "", placeholder: "Supabase anon public key" }
  ];
  const result = await openModal({
    title: "\u8d26\u53f7\u540c\u6b65",
    message: sync.accountEmail ? "\u5df2\u767b\u5f55\uff1a" + sync.accountEmail : "\u8f93\u5165\u90ae\u7bb1\u548c\u5bc6\u7801\uff0c\u540c\u6b65\u4f60\u7684\u4fbf\u7b7e\u6570\u636e\u3002",
    fields: [
      ...configFields,
      { name: "email", label: "\u90ae\u7bb1", type: "email", value: sync.accountEmail || "", placeholder: "you@qq.com" },
      { name: "password", label: "\u5bc6\u7801", type: "password", value: "", placeholder: sync.accountId ? "\u7559\u7a7a\u5219\u76f4\u63a5\u540c\u6b65" : "\u81f3\u5c11 6 \u4f4d" }
    ],
    okText: sync.accountId ? "\u540c\u6b65" : "\u767b\u5f55"
  });
  if (!result) return;
  await handleAccountResult(result);
}

async function handleAccountResult(result) {
  const previousSync = state.sync || {};
  const email = String(result.email || "").trim().toLowerCase();
  const password = String(result.password || "");
  const nextSync = {
    ...previousSync,
    supabaseUrl: configuredSupabaseUrl({ ...previousSync, supabaseUrl: result.supabaseUrl }),
    supabaseAnonKey: configuredSupabaseAnonKey({ ...previousSync, supabaseAnonKey: result.supabaseAnonKey }),
    accountEmail: email
  };
  const accountChanged = previousSync.accountEmail && nextSync.accountEmail && previousSync.accountEmail !== nextSync.accountEmail;
  const loginSync = accountChanged ? resetSyncAccount(nextSync) : nextSync;

  if (!loginSync.supabaseUrl || !loginSync.supabaseAnonKey || !loginSync.accountEmail) {
    await openModal({ title: "\u8d26\u53f7\u540c\u6b65", message: "\u8bf7\u5148\u586b\u5199\u90ae\u7bb1\u548c Supabase \u914d\u7f6e\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }
  if (!isEmail(loginSync.accountEmail)) {
    await openModal({ title: "\u8d26\u53f7\u540c\u6b65", message: "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u90ae\u7bb1\u5730\u5740\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }
  if (!password) {
    if (!accountChanged && previousSync.accountId && (previousSync.accessToken || previousSync.refreshToken)) {
      state = { ...state, sync: nextSync };
      saveStateWithoutCloudPush();
      const synced = await syncStateWithSupabase();
      await openModal({ title: synced ? "\u540c\u6b65\u5b8c\u6210" : "\u540c\u6b65\u672a\u5b8c\u6210", message: synced ? "\u5df2\u548c\u4e91\u7aef\u540c\u6b65\u3002" : "\u5df2\u4fdd\u7559\u5f53\u524d\u6570\u636e\uff0c\u7a0d\u540e\u53ef\u518d\u6b21\u540c\u6b65\u3002", okText: "\u597d", cancelText: "\u5173\u95ed" });
      return;
    }
    await openModal({ title: "\u8d26\u53f7\u540c\u6b65", message: "\u9996\u6b21\u767b\u5f55\u6216\u5207\u6362\u90ae\u7bb1\u65f6\u9700\u8981\u8f93\u5165\u5bc6\u7801\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }
  if (password.length < 6) {
    await openModal({ title: "\u8d26\u53f7\u540c\u6b65", message: "\u5bc6\u7801\u81f3\u5c11\u9700\u8981 6 \u4f4d\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }

  let session;
  try {
    session = await loginSupabaseEmailAccount(loginSync, password);
  } catch (error) {
    await openModal({ title: "\u8d26\u53f7\u540c\u6b65", message: error.message || "\u767b\u5f55\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }

  const isFirstLink = accountChanged || (!previousSync.firstLinkedAt && !previousSync.lastPushedAt);
  const localHasData = hasLocalUserData();
  state = {
    ...state,
    sync: {
      ...loginSync,
      enabled: true,
      accountId: session.user?.id || loginSync.accountId,
      accountEmail: session.user?.email || loginSync.accountEmail,
      accessToken: session.access_token,
      refreshToken: session.refresh_token || null,
      firstLinkedAt: accountChanged ? new Date().toISOString() : (previousSync.firstLinkedAt || new Date().toISOString())
    }
  };
  saveStateWithoutCloudPush();
  const synced = isFirstLink ? await finishFirstAccountLink(localHasData) : await syncStateWithSupabase();
  await openModal({
    title: synced ? "\u540c\u6b65\u5b8c\u6210" : "\u540c\u6b65\u672a\u5b8c\u6210",
    message: synced ? "\u5f53\u524d\u4fbf\u7b7e\u6570\u636e\u5df2\u548c\u4f60\u7684\u8d26\u53f7\u540c\u6b65\u3002" : "\u5df2\u4fdd\u7559\u5f53\u524d\u6570\u636e\uff0c\u7a0d\u540e\u53ef\u518d\u6b21\u540c\u6b65\u3002",
    okText: "\u597d",
    cancelText: "\u5173\u95ed"
  });
}

function resetSyncAccount(sync) {
  return {
    ...sync,
    enabled: false,
    accountId: null,
    accessToken: null,
    refreshToken: null,
    firstLinkedAt: null,
    lastPulledAt: null,
    lastPushedAt: null
  };
}
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function loginSupabaseEmailAccount(sync, password) {
  try {
    return await signInSupabasePassword(sync, password);
  } catch (loginError) {
    if (isEmailConfirmationError(loginError)) {
      await resendSupabaseConfirmation(sync);
      throw new Error("\u786e\u8ba4\u90ae\u4ef6\u5df2\u91cd\u65b0\u53d1\u9001\u3002\u8bf7\u5148\u53bb\u90ae\u7bb1\u70b9\u51fb\u786e\u8ba4\u94fe\u63a5\uff0c\u7136\u540e\u56de\u5230\u5e94\u7528\u91cd\u65b0\u767b\u5f55\u3002");
    }
    try {
      const session = await signUpSupabasePassword(sync, password);
      if (session?.access_token) return session;
      throw new Error("\u786e\u8ba4\u90ae\u4ef6\u5df2\u53d1\u9001\u3002\u8bf7\u5148\u53bb\u90ae\u7bb1\u70b9\u51fb\u786e\u8ba4\u94fe\u63a5\uff0c\u7136\u540e\u56de\u5230\u5e94\u7528\u91cd\u65b0\u767b\u5f55\u3002");
    } catch (signupError) {
      if (isEmailConfirmationError(signupError)) {
        await resendSupabaseConfirmation(sync);
        throw new Error("\u786e\u8ba4\u90ae\u4ef6\u5df2\u91cd\u65b0\u53d1\u9001\u3002\u8bf7\u5148\u53bb\u90ae\u7bb1\u70b9\u51fb\u786e\u8ba4\u94fe\u63a5\uff0c\u7136\u540e\u56de\u5230\u5e94\u7528\u91cd\u65b0\u767b\u5f55\u3002");
      }
      if (isEmailRateLimitError(signupError)) {
        throw new Error("\u786e\u8ba4\u90ae\u4ef6\u53d1\u9001\u592a\u9891\u7e41\uff0cSupabase \u6682\u65f6\u9650\u5236\u4e86\u53d1\u9001\u3002\u8bf7\u7a0d\u540e\u518d\u8bd5\uff0c\u6216\u5728 Supabase \u914d\u7f6e\u81ea\u5b9a\u4e49 SMTP\u3002");
      }
      if (isAlreadyRegisteredError(signupError)) throw loginError;
      throw signupError;
    }
  }
}

function isEmailConfirmationError(error) {
  return /email not confirmed|not confirmed/i.test(error?.message || "");
}

function isEmailRateLimitError(error) {
  return /rate limit|too many|email rate limit exceeded/i.test(error?.message || "");
}

function isAlreadyRegisteredError(error) {
  return /already registered|already exists|user exists/i.test(error?.message || "");
}

async function signInSupabasePassword(sync, password) {
  return await supabaseFetch(sync, "/auth/v1/token?grant_type=password", {
    silent: true,
    method: "POST",
    body: JSON.stringify({ email: sync.accountEmail, password })
  });
}

async function signUpSupabasePassword(sync, password) {
  return await supabaseFetch(sync, "/auth/v1/signup", {
    silent: true,
    method: "POST",
    body: JSON.stringify({ email: sync.accountEmail, password })
  });
}

async function resendSupabaseConfirmation(sync) {
  return await supabaseFetch(sync, "/auth/v1/resend", {
    silent: true,
    method: "POST",
    body: JSON.stringify({ type: "signup", email: sync.accountEmail })
  });
}

function hasLocalUserData() {
  return Boolean(state.tasks?.length || state.customDates?.length || state.ranges?.length || state.timeline?.length);
}

async function finishFirstAccountLink(localHasData) {
  const remote = await pullStateFromSupabase();
  if (!remote) return await pushStateToSupabase();
  if (!localHasData) return await applyRemoteState(remote, state.sync || {});
  await backupRemoteStateForConflict(remote);
  const result = await openModal({
    title: "账号已有数据",
    message: "云端账号里已经有便签数据。请选择保留本机数据，还是使用云端数据。",
    fields: [{ name: "choice", label: "保留数据", type: "select", value: "local", options: [
      { value: "local", label: "保留本机并上传" },
      { value: "cloud", label: "使用云端覆盖本机" }
    ] }],
    okText: "继续",
    cancelText: "稍后处理"
  });
  if (!result) return false;
  if (result.choice === "cloud") return await applyRemoteState(remote, state.sync || {});
  return await pushStateToSupabase();
}


async function backupLocalStateBeforeCloudPull() {
  const value = JSON.stringify(state);
  try { localStorage.setItem(`${STORAGE_KEY}.backup.before-cloud-pull`, value); } catch (error) { console.warn("localStorage backup failed", error); }
  await invokeWindow("backup_app_state", { reason: "before-cloud-pull", value });
}

async function backupRemoteStateForConflict(remote) {
  const value = JSON.stringify(remote.state);
  try { localStorage.setItem(`${STORAGE_KEY}.backup.remote-conflict`, value); } catch (error) { console.warn("localStorage backup failed", error); }
  await invokeWindow("backup_app_state", { reason: "remote-conflict", value });
}

async function syncStateWithSupabase(options = {}) {
  if (cloudSyncRunning) return false;
  cloudSyncRunning = true;
  try {
    const remote = await pullStateFromSupabase(options);
    if (!remote) return await pushStateToSupabase(options);

    const localSync = state.sync || {};
    const remoteTime = Date.parse(remote.updated_at || remote.state?.sync?.lastPushedAt || 0);
    const localTime = Date.parse(localSync.updatedAt || localSync.lastPushedAt || 0);
    const lastSyncTime = Math.max(Date.parse(localSync.lastPulledAt || 0) || 0, Date.parse(localSync.lastPushedAt || 0) || 0);
    const remoteDeviceId = remote.state?.sync?.deviceId;
    const hasConflict = remoteDeviceId && remoteDeviceId !== localSync.deviceId && remoteTime > lastSyncTime && localTime > lastSyncTime;

    if (hasConflict) {
      await backupLocalStateBeforeCloudPull();
      await backupRemoteStateForConflict(remote);
      if (options.silent) return false;
      const result = await openModal({
        title: "同步冲突",
        message: "本机和云端都有新修改。为避免自动覆盖，请选择保留哪一份。",
        fields: [{ name: "choice", label: "保留数据", type: "select", value: "local", options: [
          { value: "local", label: "保留本机并上传" },
          { value: "cloud", label: "使用云端覆盖本机" }
        ] }],
        okText: "继续",
        cancelText: "稍后处理"
      });
      if (!result) return false;
      if (result.choice === "cloud") return await applyRemoteState(remote, localSync, options);
      return await pushStateToSupabase(options);
    }

    if (remoteTime > localTime) return await applyRemoteState(remote, localSync, options);
    return await pushStateToSupabase(options);
  } finally {
    cloudSyncRunning = false;
  }
}

async function applyRemoteState(remote, localSync, options = {}) {
  await backupLocalStateBeforeCloudPull();
  try {
    await pullAttachmentsFromSupabase(localSync, options);
  } catch (error) {
    console.warn("Attachment pull skipped", error);
  }
  const latestSync = activeSupabaseSync(localSync);
  const remoteState = runRollover(normalizeState(remote.state), todayKey());
  state = {
    ...remoteState,
    sync: {
      ...remoteState.sync,
      supabaseUrl: latestSync.supabaseUrl,
      supabaseAnonKey: latestSync.supabaseAnonKey,
      accessToken: latestSync.accessToken,
      refreshToken: latestSync.refreshToken,
      accountId: latestSync.accountId,
      accountEmail: latestSync.accountEmail,
      enabled: true,
      firstLinkedAt: latestSync.firstLinkedAt || remoteState.sync?.firstLinkedAt || new Date().toISOString(),
      lastPulledAt: new Date().toISOString(),
      deviceId: latestSync.deviceId || remoteState.sync?.deviceId,
      localOwnerId: latestSync.localOwnerId || remoteState.sync?.localOwnerId
    }
  };
  saveStateWithoutCloudPush();
  render();
  return true;
}

async function pullStateFromSupabase(options = {}) {
  const sync = await syncWithSession(state.sync || {}, options);
  if (!sync.supabaseUrl || !sync.supabaseAnonKey || !sync.accessToken || !sync.accountId) return null;
  const rows = await supabaseFetch(sync, "/rest/v1/app_states?user_id=eq." + encodeURIComponent(sync.accountId) + "&select=state,updated_at&limit=1", options);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function pushStateToSupabase(options = {}) {
  await nativeSaveQueue.catch((error) => console.warn("AppData save before cloud push failed", error));
  const sync = await syncWithSession(state.sync || {}, options);
  if (!sync.supabaseUrl || !sync.supabaseAnonKey || !sync.accessToken || !sync.accountId) return false;
  await pushAttachmentsToSupabase(sync, options);
  const latestSync = activeSupabaseSync(sync);
  const cloudState = { ...state, sync: cloudSafeSyncState(latestSync) };
  await supabaseFetch(latestSync, "/rest/v1/app_states", {
    silent: options.silent,
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: latestSync.accountId,
      state: cloudState,
      device_id: latestSync.deviceId,
      updated_at: new Date().toISOString()
    })
  });
  state = { ...state, sync: { ...latestSync, lastPushedAt: new Date().toISOString() } };
  saveStateWithoutCloudPush();
  return true;
}

function cloudSafeSyncState(sync) {
  const { supabaseUrl, supabaseAnonKey, accessToken, refreshToken, localOwnerId, ...safeSync } = sync || {};
  return { ...safeSync, accessToken: null, refreshToken: null };
}

async function pushAttachmentsToSupabase(sync, options = {}) {
  const attachments = await invokeWindow("list_attachments") || [];
  for (const meta of attachments) {
    try {
      const payload = await invokeWindow("read_attachment", { id: meta.id });
      if (!payload?.bytes?.length) continue;
      const storagePath = attachmentStoragePath(sync.accountId, payload.meta);
      await supabaseFetch(sync, "/storage/v1/object/todo-attachments/" + encodeStoragePath(storagePath), {
        silent: options.silent,
        method: "POST",
        headers: { "Content-Type": payload.meta.mime_type || "application/octet-stream", "x-upsert": "true" },
        body: new Uint8Array(payload.bytes)
      });
      await supabaseFetch(sync, "/rest/v1/attachments", {
        silent: options.silent,
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          user_id: sync.accountId,
          id: payload.meta.id,
          file_name: payload.meta.file_name || payload.meta.id,
          mime_type: payload.meta.mime_type || null,
          storage_path: storagePath,
          updated_at: new Date().toISOString()
        })
      });
    } catch (error) {
      console.warn("Attachment upload skipped", meta.id, error);
    }
  }
}

async function pullAttachmentsFromSupabase(sync, options = {}) {
  if (!sync?.accountId || !sync?.accessToken) return;
  const rows = await supabaseFetch(sync, "/rest/v1/attachments?user_id=eq." + encodeURIComponent(sync.accountId) + "&select=id,file_name,mime_type,storage_path", options);
  if (!Array.isArray(rows) || !rows.length) return;
  const local = await invokeWindow("list_attachments") || [];
  const localIds = new Set(local.map((item) => item.id));
  for (const item of rows) {
    if (localIds.has(item.id)) continue;
    try {
      const bytes = await supabaseFetchBytes(sync, "/storage/v1/object/todo-attachments/" + encodeStoragePath(item.storage_path), options);
      await invokeWindow("save_attachment", {
        id: item.id,
        fileName: item.file_name || item.id,
        mimeType: item.mime_type || "application/octet-stream",
        bytes: [...bytes]
      });
    } catch (error) {
      console.warn("Attachment download skipped", item.id, error);
    }
  }
}

function attachmentStoragePath(userId, meta) {
  const safeName = encodeURIComponent(meta.file_name || meta.id).replaceAll("%", "_");
  return `${userId}/${meta.id}/${safeName}`;
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function supabaseFetchBytes(sync, path, options = {}) {
  return await requestSupabase(sync, path, options, "bytes");
}

async function supabaseFetch(sync, path, options = {}) {
  return await requestSupabase(sync, path, options, "json");
}

async function requestSupabase(sync, path, options = {}, responseType = "json", allowRefresh = true) {
  sync = activeSupabaseSync(sync);
  const silent = Boolean(options.silent);
  const fetchOptions = { ...options };
  delete fetchOptions.silent;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_REST_TIMEOUT_MS);
  try {
    const response = await fetch(sync.supabaseUrl + path, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        apikey: sync.supabaseAnonKey,
        Authorization: "Bearer " + (sync.accessToken || sync.supabaseAnonKey),
        ...(responseType === "json" ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {})
      }
    });
    if (response.status === 401 && allowRefresh && sync.refreshToken) {
      clearTimeout(timeout);
      const refreshed = await refreshSupabaseSession(sync, { silent });
      return await requestSupabase(refreshed, path, options, responseType, false);
    }
    if (responseType === "bytes") {
      if (!response.ok) throw new Error(response.statusText);
      return new Uint8Array(await response.arrayBuffer());
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.msg || data?.message || response.statusText);
    return data;
  } catch (error) {
    if (!silent) await openModal({ title: responseType === "bytes" ? "附件同步失败" : "同步失败", message: error.message || "请检查网络和 Supabase 配置。", okText: "知道了", cancelText: "关闭" });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}


async function syncWithSession(sync, options = {}) {
  if (sync?.accessToken || !sync?.refreshToken) return sync;
  return await refreshSupabaseSession(sync, options);
}
function activeSupabaseSync(sync) {
  const current = state.sync || {};
  if (current.accountId && sync?.accountId === current.accountId && current.accessToken) {
    return { ...sync, accessToken: current.accessToken, refreshToken: current.refreshToken };
  }
  return sync;
}

async function refreshSupabaseSession(sync, options = {}) {
  const silent = Boolean(options.silent);
  if (!sync?.supabaseUrl || !sync?.supabaseAnonKey || !sync?.refreshToken) throw new Error("请重新登录账号同步。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_REST_TIMEOUT_MS);
  try {
    const response = await fetch(sync.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: sync.supabaseAnonKey,
        Authorization: "Bearer " + sync.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ refresh_token: sync.refreshToken })
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.msg || data?.message || response.statusText);
    state = {
      ...state,
      sync: {
        ...state.sync,
        enabled: true,
        accountId: data.user?.id || state.sync?.accountId || sync.accountId,
        accountEmail: state.sync?.accountEmail || sync.accountEmail || data.user?.email,
        accessToken: data.access_token,
        refreshToken: data.refresh_token || sync.refreshToken
      }
    };
    saveStateWithoutCloudPush();
    return state.sync;
  } catch (error) {
    throw new Error(error.message || "登录状态已过期，请重新输入密码。");
  } finally {
    clearTimeout(timeout);
  }
}

async function addFutureDate() {
  const start = addDays(todayKey(), 1);
  const result = await openModal({
    title: "添加日期或时间段",
    fields: [
      { name: "startDate", label: "开始日期", type: "date", value: start },
      { name: "endDate", label: "结束日期", type: "date", value: start }
    ],
    okText: "添加"
  });
  if (!result?.startDate) return;
  const startDate = toDateKey(result.startDate);
  const endDate = result.endDate && result.endDate >= startDate ? toDateKey(result.endDate) : startDate;
  const block = endDate === startDate ? startDate : { startDate, endDate };
  update((s) => ({
    ...s,
    customDates: [...(s.customDates || []).filter((item) => customDateKey(item) !== startDate), block].sort((a, b) => customDateKey(a).localeCompare(customDateKey(b))),
    ui: { ...s.ui, activeDate: startDate, showArchive: false, dateMenuKey: null }
  }));
}

function customBlock(date) {
  return (state.customDates || []).find((item) => customDateKey(item) === date);
}

function dateInBlock(date, block) {
  if (!date) return false;
  return typeof block === "string" ? date === block : block.startDate <= date && date <= block.endDate;
}

function openDateMenu(event) {
  const date = event.currentTarget.dataset.dateChip;
  if (!customBlock(date)) return;
  event.preventDefault();
  update((s) => ({ ...s, ui: { ...s.ui, dateMenuKey: s.ui.dateMenuKey === date ? null : date } }));
}

async function deleteDateBlock(date) {
  const block = customBlock(date);
  if (!block) return;
  const ok = await openModal({ title: "删除日期块", message: "会删除这个块和其中的待办。", okText: "删除", cancelText: "取消" });
  if (!ok) return;
  update((s) => ({
    ...s,
    customDates: (s.customDates || []).filter((item) => customDateKey(item) !== date),
    tasks: s.tasks.filter((task) => !dateInBlock(task.date, block)),
    ui: { ...s.ui, activeDate: todayKey(), dateMenuKey: null }
  }));
}

async function addTaskForDate(date) {
  const result = await openModal({
    title: "添加待办",
    fields: taskFields({ title: "", date, priority: "P2" }),
    okText: "添加"
  });
  if (!result?.title?.trim()) return;
  const priority = PRIORITIES.includes(result.priority) ? result.priority : "P2";
  update((s) => ({
    ...s,
    tasks: [...s.tasks, makeTask({ title: result.title.trim(), date: result.date || date, priority, historicalEntry: (result.date || date) < todayKey(), order: nextOrder(s.tasks, result.date || date, priority) })]
  }));
}

function taskFields(task) {
  return [
    { name: "title", label: "标题", value: task.title, placeholder: "写下要做的事" },
    { name: "date", label: "日期", type: "date", value: task.date || todayKey() },
    { name: "priority", label: "优先级", type: "select", value: task.priority || "DEFERRED", options: [
      { value: "P0", label: "P0 最高" },
      { value: "P1", label: "P1 重要" },
      { value: "P2", label: "P2 普通" },
      { value: "DEFERRED", label: "拖延项" }
    ] }
  ];
}

async function deleteTask(id) {
  const ok = await openModal({ title: "删除待办", message: "这条待办会被永久删除。", okText: "删除", cancelText: "保留" });
  if (!ok) return;
  update((s) => ({ ...s, tasks: s.tasks.filter((task) => task.id !== id) }));
}

function toggleTask(id) {
  update((s) => ({
    ...s,
    tasks: s.tasks.map((task) => task.id === id ? { ...task, completed: !task.completed, updatedAt: new Date().toISOString() } : task)
  }));
}

function beginTitleEdit(event) {
  const node = event.currentTarget;
  titleEditOriginals.set(node.dataset.titleId, editableText(node));
}

function handleTitleEditKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelTitleEdit(event);
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    insertEditableLineBreak();
    return;
  }
  event.currentTarget.blur();
}

function finishTitleEdit(event) {
  const node = event.currentTarget;
  const id = node.dataset.titleId;
  if (!id) return;

  const nextTitle = editableText(node);
  const currentTask = state.tasks.find((task) => task.id === id);
  if (!currentTask) return;

  if (!nextTitle.trim()) {
    node.textContent = currentTask.title;
    titleEditOriginals.delete(id);
    return;
  }

  if (nextTitle === currentTask.title) {
    titleEditOriginals.delete(id);
    return;
  }

  update((s) => ({
    ...s,
    tasks: s.tasks.map((task) => task.id === id ? { ...task, title: nextTitle, updatedAt: new Date().toISOString() } : task)
  }), { render: false });
  titleEditOriginals.delete(id);
}

function cancelTitleEdit(event) {
  const node = event.currentTarget;
  const id = node.dataset.titleId;
  if (!id || !titleEditOriginals.has(id)) return;
  node.textContent = titleEditOriginals.get(id);
  titleEditOriginals.delete(id);
  node.blur();
}

function editableText(node) {
  return (node.innerText ?? node.textContent ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function insertEditableLineBreak() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const lineBreak = document.createTextNode("\n");
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function toggleDetail(id) {
  update((s) => ({ ...s, ui: { ...s.ui, expandedTaskId: s.ui.expandedTaskId === id ? null : id } }));
}


function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function toggleHistoryView() {
  const opening = !state.ui.historyOpen;
  const month = normalizeHistoryMonth(state.ui.historyMonth);
  const selectedDate = historySelectedDate(month);
  state = {
    ...state,
    ui: {
      ...state.ui,
      historyOpen: opening,
      historyMonth: month,
      historyDate: selectedDate,
      timelineOpen: false,
      editingTimelineId: null
    }
  };
  saveState();
  render();
  await nextFrame();
}

function setHistoryMonth(value) {
  const month = normalizeHistoryMonth(value);
  update((s) => ({
    ...s,
    ui: { ...s.ui, historyMonth: month, historyDate: historyDefaultDateForMonth(month) }
  }));
}

function shiftHistoryMonth(delta) {
  const month = normalizeHistoryMonth(state.ui.historyMonth);
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber - 1 + delta, 1);
  setHistoryMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
}

function selectHistoryDate(date) {
  if (!date || date >= todayKey()) return;
  update((s) => ({ ...s, ui: { ...s.ui, historyDate: date, historyMonth: date.slice(0, 7) } }));
}
async function toggleTimelinePanel() {
  const opening = !state.ui.timelineOpen;
  if (opening) {
    timelineRestoreWidth = await invokeWindow("set_window_width", { width: TIMELINE_WINDOW_WIDTH }) || timelineRestoreWidth;
  }
  state = {
    ...state,
    ui: {
      ...state.ui,
      timelineOpen: opening,
      editingTimelineId: null,
      historyOpen: false
    }
  };
  saveState();
  render();
  await nextFrame();
  if (!opening && timelineRestoreWidth) {
    await invokeWindow("set_window_width", { width: Math.max(NOTE_WINDOW_WIDTH, timelineRestoreWidth) });
    timelineRestoreWidth = null;
  }
}

function startTimelineEdit(id) {
  clearTimelineAutosave();
  update((s) => ({ ...s, ui: { ...s.ui, editingTimelineId: id } }));
}

function bindTimelineAutosave() {
  const root = app.querySelector("[data-timeline-editor]");
  if (!root) return;
  root.querySelectorAll("[data-timeline-title], [data-timeline-start], [data-timeline-end], .rich-editor").forEach((node) => {
    node.addEventListener("input", scheduleTimelineAutosave);
    node.addEventListener("change", scheduleTimelineAutosave);
  });
}

function scheduleTimelineAutosave() {
  setTimelineSaveStatus("\u6b63\u5728\u4fdd\u5b58...");
  clearTimeout(timelineAutosaveTimer);
  timelineAutosaveTimer = setTimeout(() => saveTimelineInline(currentTimelineEditorId(), { closeEditor: false }), TIMELINE_AUTOSAVE_DELAY_MS);
}

function clearTimelineAutosave() {
  clearTimeout(timelineAutosaveTimer);
  timelineAutosaveTimer = null;
}

function currentTimelineEditorId() {
  return app.querySelector("[data-timeline-editor]")?.dataset.timelineEditor || state.ui.editingTimelineId || "new";
}

function returnToTimelineList() {
  clearTimelineAutosave();
  saveTimelineInline(currentTimelineEditorId(), { closeEditor: true });
}

async function deleteTimeline(id) {
  const item = state.timeline.find((entry) => entry.id === id);
  if (!item) return;
  const ok = await openModal({ title: "\u5220\u9664\u65f6\u95f4\u8f74", message: "\u8fd9\u6761\u65f6\u95f4\u8f74\u4f1a\u88ab\u5220\u9664\u3002", okText: "\u5220\u9664", cancelText: "\u53d6\u6d88" });
  if (!ok) return;
  update((s) => ({
    ...s,
    timeline: s.timeline.filter((entry) => entry.id !== id),
    ui: { ...s.ui, editingTimelineId: s.ui.editingTimelineId === id ? null : s.ui.editingTimelineId }
  }));
}

function setTimelineSaveStatus(text) {
  const node = app.querySelector("[data-timeline-save-status]");
  if (!node) return;
  node.textContent = text;
}

function markTimelineSaved() {
  setTimelineSaveStatus(`\u5df2\u4fdd\u5b58 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
}

function saveTimelineInline(id, options = {}) {
  const { closeEditor = true } = options;
  if (closeEditor) clearTimelineAutosave();
  const root = app.querySelector("[data-timeline-editor]");
  if (!root) return;
  const title = root.querySelector("[data-timeline-title]")?.value?.trim() || "\u672a\u547d\u540d\u65f6\u95f4\u8f74";
  const startDate = toDateKey(root.querySelector("[data-timeline-start]")?.value || todayKey());
  const rawEndDate = root.querySelector("[data-timeline-end]")?.value || startDate;
  const endDate = rawEndDate >= startDate ? toDateKey(rawEndDate) : startDate;
  const contentHtml = sanitizeRichHtml(root.querySelector(".rich-editor"));
  const summary = plainTextFromRichHtml(contentHtml);
  const savedId = id === "new" ? makeId("timeline") : id;
  update((s) => {
    const item = { id: savedId, title, startDate, endDate, summary, contentHtml, updatedAt: new Date().toISOString() };
    const exists = s.timeline.some((entry) => entry.id === item.id);
    return {
      ...s,
      timeline: exists
        ? s.timeline.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry)
        : [...s.timeline, { ...item, attachments: [], createdAt: new Date().toISOString() }],
      ui: { ...s.ui, editingTimelineId: closeEditor ? null : savedId }
    };
  }, { render: closeEditor });
  if (!closeEditor) {
    root.dataset.timelineEditor = savedId;
    root.querySelector("[data-action='save-timeline-inline']")?.setAttribute("data-id", savedId);
    markTimelineSaved();
  }
}

function stopImageClickPropagation(event) {
  event.preventDefault();
  event.stopPropagation();
}

function openImageFromElement(event) {
  const fileId = event.currentTarget?.dataset?.fileId;
  if (!fileId) return;
  event.preventDefault();
  event.stopPropagation();
  openImageViewer(fileId);
}

async function openImageViewer(fileId) {
  if (await invokeWindow("open_stored_attachment", { id: fileId })) return;
  const file = await getStoredFile(fileId);
  if (!file) return;
  await saveNativeAttachment(fileId, file);
  if (await invokeWindow("open_stored_attachment", { id: fileId })) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await invokeWindow("open_image_viewer", {
    fileName: file.name || `image-${fileId}`,
    mimeType: file.type || "image/png",
    bytes: [...bytes]
  });
}
function bindRichEditor(node) {
  node.addEventListener("paste", handleRichPaste);
}

async function handleRichPaste(event) {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!files.length && !text) return;
  event.preventDefault();
  const range = currentSelectionRange();
  for (const file of files) await insertRichImage(file, range);
  if (!files.length && text) insertPlainText(text);
}

function currentSelectionRange() {
  const selection = window.getSelection();
  return selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
}

function restoreSelectionRange(range) {
  if (!range) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

async function insertRichImage(file, range) {
  const id = makeId("image");
  await putFile(id, file);
  restoreSelectionRange(range);
  const src = URL.createObjectURL(file);
  imageSrcByFileId.set(id, src);
  document.execCommand("insertHTML", false, `<img data-file-id="${id}" alt="${escapeHtml(file.name || "pasted image")}" src="${src}">`);
}

function insertPlainText(text) {
  document.execCommand("insertText", false, text);
}

function sanitizeRichHtml(node) {
  if (!node) return "";
  const clone = node.cloneNode(true);
  clone.querySelectorAll("script, style").forEach((item) => item.remove());
  clone.querySelectorAll("*").forEach((item) => {
    if (item.tagName === "IMG") {
      const fileId = item.dataset.fileId;
      if (!fileId) return item.remove();
      item.removeAttribute("src");
      item.setAttribute("data-file-id", fileId);
      item.setAttribute("alt", item.getAttribute("alt") || "pasted image");
      [...item.attributes].forEach((attr) => {
        if (!["data-file-id", "alt"].includes(attr.name)) item.removeAttribute(attr.name);
      });
      return;
    }
    [...item.attributes].forEach((attr) => item.removeAttribute(attr.name));
  });
  return clone.innerHTML.trim();
}

function richTextFromPlain(value) {
  return escapeHtml(value || "").replace(/\n/g, "<br>");
}

function plainTextFromRichHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return (template.content.textContent || "").trim();
}

async function hydrateRichImages() {
  const images = [...app.querySelectorAll("img[data-file-id]:not([src])")];
  for (const image of images) {
    const src = await imagePreviewSrc(image.dataset.fileId);
    if (src) image.src = src;
  }
}

async function imagePreviewSrc(fileId) {
  if (!fileId) return "";
  if (imageSrcByFileId.has(fileId)) return imageSrcByFileId.get(fileId);
  const file = await getStoredFile(fileId);
  const src = file
    ? URL.createObjectURL(file)
    : await nativeAttachmentPreviewSrc(fileId);
  if (!src) return "";
  imageSrcByFileId.set(fileId, src);
  return src;
}

async function nativeAttachmentPreviewSrc(fileId) {
  const attachment = await readNativeAttachment(fileId);
  return attachment ? URL.createObjectURL(attachment.blob) : "";
}

function pruneImagePreviewCache() {
  const visibleIds = new Set([...app.querySelectorAll("img[data-file-id]")].map((image) => image.dataset.fileId));
  for (const [fileId, src] of imageSrcByFileId) {
    if (visibleIds.has(fileId)) continue;
    URL.revokeObjectURL(src);
    imageSrcByFileId.delete(fileId);
  }
}

async function readNativeAttachment(id) {
  const payload = await invokeWindow("read_attachment", { id });
  if (!payload?.bytes?.length) return null;
  return {
    blob: new Blob(
      [new Uint8Array(payload.bytes)],
      { type: payload.meta?.mime_type || "application/octet-stream" }
    ),
    name: payload.meta?.file_name || "attachment"
  };
}

async function repairNativeAttachmentsFromIndexedDb() {
  if (!window.__TAURI__) return;
  for (const fileId of referencedAttachmentIds(state)) {
    const file = await getStoredFile(fileId);
    if (file) await saveNativeAttachment(fileId, file);
  }
}

function referencedAttachmentIds(value) {
  const html = [
    ...(value.tasks || []).map((task) => task.detailHtml),
    ...(value.timeline || []).map((item) => item.contentHtml)
  ].filter(Boolean).join("\n");
  return Array.from(new Set(Array.from(html.matchAll(/data-file-id="([^"]+)"/g), (match) => match[1])));
}
function saveDetail(id, options = {}) {
  const editor = app.querySelector(`[data-detail-id="${id}"]`);
  const detailHtml = sanitizeRichHtml(editor);
  const detail = plainTextFromRichHtml(detailHtml);
  const currentTask = state.tasks.find((task) => task.id === id);
  if (!currentTask) return;
  if ((currentTask.detailHtml || richTextFromPlain(currentTask.detail || "")) === detailHtml) return;
  update((s) => ({
    ...s,
    tasks: s.tasks.map((task) => task.id === id ? { ...task, detail, detailHtml, updatedAt: new Date().toISOString() } : task)
  }), options);
}

function openModal(config) {
  return new Promise((resolve) => {
    modalState = { ...config, resolve };
    render();
    setTimeout(() => app.querySelector(".pixel-modal input, .pixel-modal textarea, .pixel-modal select")?.focus(), 0);
  });
}

function submitModal(event) {
  event.preventDefault();
  if (!modalState) return;
  if (!modalState.fields?.length) return closeModal(true);
  const data = new FormData(event.currentTarget);
  const values = Object.fromEntries(data.entries());
  closeModal(values);
}

function closeModal(value) {
  const resolver = modalState?.resolve;
  modalState = null;
  resolver?.(value);
  render();
}

function pickAndStoreFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = [...input.files];
      const stored = [];
      for (const file of files) {
        const id = makeId("file");
        await putFile(id, file);
        stored.push({ id, name: file.name, type: file.type, size: file.size });
      }
      resolve(stored);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function openFileDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putFile(id, file) {
  const nativeSaved = await saveNativeAttachment(id, file);
  try {
    const db = await openFileDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readwrite");
      tx.objectStore(FILE_STORE).put(file, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    if (nativeSaved) return;
    throw error;
  }
}

async function saveNativeAttachment(id, file) {
  if (!window.__TAURI__) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return Boolean(await invokeWindow("save_attachment", {
    id,
    fileName: file.name || `image-${id}`,
    mimeType: file.type || "image/png",
    bytes: [...bytes]
  }));
}

async function getStoredFile(id) {
  try {
    const db = await openFileDb();
    const file = await new Promise((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readonly");
      const req = tx.objectStore(FILE_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return file;
  } catch (error) {
    console.warn("IndexedDB attachment read skipped", error);
    return null;
  }
}

async function downloadAttachment(id) {
  const file = await getStoredFile(id);
  const attachment = file ? { blob: file, name: file.name || "attachment" } : await readNativeAttachment(id);
  if (!attachment) {
    await openModal({ title: "\u9644\u4ef6\u672a\u627e\u5230", message: "\u8fd9\u4e2a\u9644\u4ef6\u6ca1\u6709\u5728\u5e94\u7528\u5e93\u91cc\u627e\u5230\u3002", okText: "\u77e5\u9053\u4e86", cancelText: "\u5173\u95ed" });
    return;
  }
  const url = URL.createObjectURL(attachment.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = attachment.name;
  a.click();
  URL.revokeObjectURL(url);
}
function nextOrder(tasks, date, group, dateMatches = (task) => task.date === date) {
  const same = tasks.filter((task) => dateMatches(task) && (task.priority || "DEFERRED") === group);
  return same.length ? Math.max(...same.map((task) => task.order || 0)) + 1 : 1;
}


async function toggleAlwaysOnTop() {
  const next = !state.ui.alwaysOnTop;
  await invokeWindow("set_always_on_top", { alwaysOnTop: next });
  update((s) => ({ ...s, ui: { ...s.ui, alwaysOnTop: next } }));
}

async function closeApp() {
  await nativeSaveQueue.catch((error) => console.warn("AppData save before close failed", error));
  await invokeWindow("close");
}

async function invokeWindow(command, args = {}) {
  const tauri = window.__TAURI__;
  if (!tauri) return;

  try {
    const currentWindow = tauri.window?.getCurrentWindow?.();
    if (currentWindow) {
      if (command === "start_dragging") {
        await currentWindow.startDragging();
        return;
      }
      if (command === "minimize") {
        await currentWindow.minimize();
        return;
      }
      if (command === "close") {
        await currentWindow.close();
        return;
      }
      if (command === "set_always_on_top") {
        await currentWindow.setAlwaysOnTop(Boolean(args.alwaysOnTop));
        return;
      }
    }

    const invoke = tauri.core?.invoke;
    if (!invoke) return;
    return await invoke(command, args);
  } catch (error) {
    console.warn(`Tauri command failed: ${command}`, error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}







