export const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

export function modeLabel(mode) {
  return ({ auto: "自動", morning: "朝モード", replan: "再設計モード", night: "夜モード" })[mode] || "自動";
}

export function detectAutoMode(currentMinutes) {
  if (currentMinutes >= 18 * 60) return "night";
  if (currentMinutes >= 11 * 60 + 30) return "replan";
  return "morning";
}

export function getNowContext(dateStr, requestedMode = "auto") {
  const now = new Date();
  const todayStr = formatDateInput(now);
  const safeDateStr = dateStr || todayStr;
  const isToday = safeDateStr === todayStr;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const autoMode = detectAutoMode(currentMinutes);
  const effectiveMode = requestedMode === "auto" ? autoMode : requestedMode;

  return {
    now,
    todayStr,
    isToday,
    selectedDate: new Date(`${safeDateStr}T00:00:00`),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
    currentMinutes,
    autoMode,
    requestedMode,
    effectiveMode,
    effectiveModeLabel: modeLabel(effectiveMode),
    currentDateLabel: formatDateTimeForDisplay(now)
  };
}

export function startClock(onTick) {
  onTick?.();
  return window.setInterval(() => {
    onTick?.();
  }, 60 * 1000);
}

export function isSelectedDateToday(selectedDateValue) {
  return selectedDateValue === formatDateInput(new Date());
}

export function isValidTimeRange(start, end) {
  return toMinutes(end) > toMinutes(start);
}

export function roundToFiveMinutes(date) {
  const rounded = new Date(date);
  rounded.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return rounded;
}

export function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatTimeOnly(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDateTimeForDisplay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function toMinutes(timeStr) {
  if (!timeStr) return NaN;
  const [h, m] = timeStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

export function fromMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateInput(date);
}

export function getStartOfWeek(dateStr, weekStartsOn = 1) {
  const date = new Date(`${dateStr}T00:00:00`);
  const currentDay = date.getDay();
  const diff = (currentDay - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatDateInput(date);
}

export function getEndOfWeek(dateStr, weekStartsOn = 1) {
  return addDays(getStartOfWeek(dateStr, weekStartsOn), 6);
}

export function getWeekDates(dateStr, weekStartsOn = 1) {
  const start = getStartOfWeek(dateStr, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function getWeekKey(dateStr, weekStartsOn = 1) {
  const start = getStartOfWeek(dateStr, weekStartsOn);
  return `${start}_${getEndOfWeek(dateStr, weekStartsOn)}`;
}

export function getWeekLabel(dateStr, weekStartsOn = 1) {
  const start = getStartOfWeek(dateStr, weekStartsOn);
  const end = getEndOfWeek(dateStr, weekStartsOn);
  return `${start} - ${end}`;
}

export function isDateInRange(dateStr, startDate, endDate) {
  if (!dateStr || !startDate || !endDate) return false;
  return dateStr >= startDate && dateStr <= endDate;
}

export function getMonthKey(dateStr) {
  const safeDate = dateStr || formatDateInput(new Date());
  return safeDate.slice(0, 7);
}
