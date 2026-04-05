import { state } from './state.js';
import { formatDateInput, toMinutes } from './time.js';

export const TRAVEL_METHOD_LABELS = {
  walk: '徒歩',
  bicycle: '自転車',
  jr: 'JR',
  bus: 'バス',
  car: '車',
  other: 'その他'
};

export function trimText(value) {
  return String(value || '').trim();
}

export function getTravelMethodLabel(method) {
  return TRAVEL_METHOD_LABELS[trimText(method)] || '移動';
}

export function getVisibleOneOffEvents(items = state.oneOffEvents || []) {
  return (items || []).filter((item) => !trimText(item?.dismissedAt));
}

export function isCleanupCandidateEvent(item, referenceNow = new Date()) {
  if (!item || trimText(item.dismissedAt) || !trimText(item.date)) return false;
  const today = formatDateInput(referenceNow);
  if (item.date < today) return true;
  if (item.date > today) return false;
  if (item.allDay) return false;

  const currentMinutes = referenceNow.getHours() * 60 + referenceNow.getMinutes();
  const endMinutes = Number.isFinite(toMinutes(item.end))
    ? toMinutes(item.end)
    : Number.isFinite(toMinutes(item.start))
      ? toMinutes(item.start) + 30
      : NaN;
  return Number.isFinite(endMinutes) && endMinutes <= currentMinutes;
}

export function collectKnownPlaceNames(sourceState = state) {
  const names = new Set();
  const push = (value) => {
    const text = trimText(value);
    if (text) names.add(text);
  };

  (sourceState.studyLocations || []).forEach((item) => push(item?.name));
  (sourceState.fixedSchedules || []).forEach((item) => push(item?.placeName));
  (sourceState.oneOffEvents || []).forEach((item) => push(item?.placeName));
  (sourceState.travelRoutes || []).forEach((item) => {
    push(item?.fromPlace);
    push(item?.toPlace);
  });

  return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function parseTimetableEntries(text) {
  const matches = String(text || '').match(/\b\d{1,2}:\d{2}\b/g) || [];
  return [...new Set(matches.map((value) => normalizeClock(value)).filter(Boolean))].sort();
}

export function normalizeClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function isTimetableActiveForDate(route, dateStr) {
  const mode = trimText(route?.timetableMode) || 'daily';
  if (mode === 'daily') return true;
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  if (mode === 'weekday') return weekday >= 1 && weekday <= 5;
  if (mode === 'weekend') return weekday === 0 || weekday === 6;
  return true;
}

export function describeTimetableMode(route) {
  return ({ daily: '毎日', weekday: '平日', weekend: '土日祝メモ' })[trimText(route?.timetableMode) || 'daily'] || '毎日';
}

export function getNextDeparture(route, referenceTime, dateStr) {
  const entries = parseTimetableEntries(route?.timetableText);
  if (!entries.length || !isTimetableActiveForDate(route, dateStr)) return null;
  const referenceMinutes = Number.isFinite(toMinutes(referenceTime)) ? toMinutes(referenceTime) : 0;
  return entries.find((value) => toMinutes(value) >= referenceMinutes) || null;
}

export function findBestTravelRoute(fromPlace, toPlace, sourceState = state) {
  const from = trimText(fromPlace);
  const to = trimText(toPlace);
  if (!from || !to || from === to) return null;

  const exact = (sourceState.travelRoutes || []).find((route) => trimText(route.fromPlace) === from && trimText(route.toPlace) === to);
  if (exact) return { ...exact, reverseFallback: false };

  const reverse = (sourceState.travelRoutes || []).find((route) => trimText(route.fromPlace) === to && trimText(route.toPlace) === from);
  if (reverse) return { ...reverse, reverseFallback: true };

  return null;
}

export function buildMovementPlanLines(dateStr, schedules = [], sourceState = state) {
  const timed = (schedules || [])
    .filter((item) => !item?.allDay && trimText(item?.start) && trimText(item?.placeName))
    .map((item) => ({
      ...item,
      endForMove: normalizeClock(item.end) || normalizeClock(item.start)
    }))
    .filter((item) => item.endForMove)
    .sort((a, b) => `${a.start}${a.title}`.localeCompare(`${b.start}${b.title}`));

  if (timed.length < 2) return [];

  const lines = [];
  for (let index = 0; index < timed.length - 1; index += 1) {
    const current = timed[index];
    const next = timed[index + 1];
    if (!trimText(current.placeName) || !trimText(next.placeName) || trimText(current.placeName) === trimText(next.placeName)) continue;

    const route = findBestTravelRoute(current.placeName, next.placeName, sourceState);
    if (!route) {
      lines.push(`${current.title} → ${next.title} / ${current.placeName} → ${next.placeName} / ルート未登録`);
      continue;
    }

    const travelMinutes = Number(route.durationMinutes || 0);
    const nextDeparture = getNextDeparture(route, current.endForMove, dateStr);
    const gapMinutes = Number.isFinite(toMinutes(next.start)) && Number.isFinite(toMinutes(current.endForMove))
      ? toMinutes(next.start) - toMinutes(current.endForMove)
      : NaN;

    const parts = [
      `${current.title} → ${next.title}`,
      `${current.placeName} → ${next.placeName}`,
      `${getTravelMethodLabel(route.method)} ${travelMinutes || '?'}分`
    ];

    if (nextDeparture) parts.push(`次発 ${nextDeparture}`);
    if (route.reverseFallback) parts.push('逆方向流用');

    if (Number.isFinite(gapMinutes) && travelMinutes > 0) {
      if (gapMinutes < travelMinutes) parts.push(`移動不足 ${travelMinutes - gapMinutes}分`);
      else parts.push(`余裕 ${gapMinutes - travelMinutes}分`);
    }

    if (trimText(route.note)) parts.push(route.note);
    lines.push(parts.join(' / '));
  }

  return lines.slice(0, 8);
}

export function sortTravelRoutesForDisplay(routes = state.travelRoutes || []) {
  return [...(routes || [])].sort((a, b) => {
    const aKey = `${trimText(a.fromPlace)}${trimText(a.toPlace)}${trimText(a.method)}`;
    const bKey = `${trimText(b.fromPlace)}${trimText(b.toPlace)}${trimText(b.method)}`;
    return aKey.localeCompare(bKey, 'ja');
  });
}
