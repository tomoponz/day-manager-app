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

export function getPlaceNameById(placeId, sourceState = state) {
  const id = trimText(placeId);
  if (!id) return '';
  return trimText((sourceState.studyLocations || []).find((item) => trimText(item?.id) === id)?.name);
}

export function resolvePlaceName(placeId, fallbackName = '', sourceState = state) {
  return getPlaceNameById(placeId, sourceState) || trimText(fallbackName);
}

export function findStudyLocationIdByName(name, sourceState = state) {
  const needle = trimText(name);
  if (!needle) return '';
  return trimText((sourceState.studyLocations || []).find((item) => trimText(item?.name) === needle)?.id);
}

function normalizeLifecycleStatus(item) {
  const raw = trimText(item?.lifecycleStatus).toLowerCase();
  if (['active', 'completed', 'hidden', 'archived'].includes(raw)) return raw;
  if (trimText(item?.dismissedAt) || trimText(item?.hiddenAt)) return 'hidden';
  if (trimText(item?.archivedAt)) return 'archived';
  if (trimText(item?.completedAt)) return 'completed';
  return 'active';
}

export function isVisibleOneOffEvent(item) {
  const lifecycleStatus = normalizeLifecycleStatus(item);
  return lifecycleStatus !== 'hidden' && lifecycleStatus !== 'archived' && !trimText(item?.dismissedAt);
}

export function getVisibleOneOffEvents(items = state.oneOffEvents || []) {
  return (items || []).filter((item) => isVisibleOneOffEvent(item));
}

export function isCleanupCandidateEvent(item, referenceNow = new Date()) {
  if (!item || !isVisibleOneOffEvent(item) || !trimText(item.date)) return false;
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
  (sourceState.fixedSchedules || []).forEach((item) => push(resolvePlaceName(item?.placeId, item?.placeName, sourceState)));
  (sourceState.oneOffEvents || []).forEach((item) => push(resolvePlaceName(item?.placeId, item?.placeName, sourceState)));
  (sourceState.travelRoutes || []).forEach((item) => {
    push(resolvePlaceName(item?.fromPlaceId, item?.fromPlace, sourceState));
    push(resolvePlaceName(item?.toPlaceId, item?.toPlace, sourceState));
  });

  return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function parseTimetableEntries(text) {
  const matches = String(text || '').match(/\b\d{1,2}:\d{2}\b/g) || [];
  return [...new Set(matches.map((value) => normalizeClock(value)).filter(Boolean))].sort();
}

export function getDepartureTimetableEntries(route) {
  return parseTimetableEntries(route?.departureTimetableText || route?.timetableText || '');
}

export function getArrivalTimetableEntries(route) {
  return parseTimetableEntries(route?.arrivalTimetableText || '');
}

export function getRouteTimetableSummary(route) {
  const departures = getDepartureTimetableEntries(route);
  const arrivals = getArrivalTimetableEntries(route);
  return {
    departures,
    arrivals,
    hasAny: departures.length > 0 || arrivals.length > 0,
    label: departures.length || arrivals.length
      ? `${describeTimetableMode(route)} / 発${departures.length}本${arrivals.length ? ` / 着${arrivals.length}本` : ''}`
      : '時刻表なし'
  };
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
  const entries = getDepartureTimetableEntries(route);
  if (!entries.length || !isTimetableActiveForDate(route, dateStr)) return null;
  const referenceMinutes = Number.isFinite(toMinutes(referenceTime)) ? toMinutes(referenceTime) : 0;
  return entries.find((value) => toMinutes(value) >= referenceMinutes) || null;
}

export function getNextTripInfo(route, referenceTime, dateStr) {
  const departures = getDepartureTimetableEntries(route);
  if (!departures.length || !isTimetableActiveForDate(route, dateStr)) {
    return { departure: null, arrival: null };
  }

  const referenceMinutes = Number.isFinite(toMinutes(referenceTime)) ? toMinutes(referenceTime) : 0;
  const departureIndex = departures.findIndex((value) => toMinutes(value) >= referenceMinutes);
  if (departureIndex < 0) {
    return { departure: null, arrival: null };
  }

  const arrivals = getArrivalTimetableEntries(route);
  const arrival = arrivals.length === departures.length ? arrivals[departureIndex] || null : null;
  return {
    departure: departures[departureIndex] || null,
    arrival
  };
}

function toPlaceRef(input, fallbackId = '', fallbackName = '', sourceState = state) {
  if (input && typeof input === 'object') {
    return {
      placeId: trimText(input.placeId || fallbackId),
      name: resolvePlaceName(input.placeId || fallbackId, input.placeName || input.name || fallbackName, sourceState)
    };
  }
  const name = trimText(input || fallbackName);
  return {
    placeId: trimText(fallbackId) || findStudyLocationIdByName(name, sourceState),
    name
  };
}

export function findBestTravelRoute(fromPlace, toPlace, sourceState = state) {
  const from = toPlaceRef(fromPlace, '', '', sourceState);
  const to = toPlaceRef(toPlace, '', '', sourceState);
  if ((!from.placeId && !from.name) || (!to.placeId && !to.name)) return null;
  if ((from.placeId && to.placeId && from.placeId === to.placeId) || (from.name && to.name && from.name === to.name)) return null;

  const exact = (sourceState.travelRoutes || []).find((route) => {
    const routeFromId = trimText(route.fromPlaceId);
    const routeToId = trimText(route.toPlaceId);
    const routeFromName = resolvePlaceName(routeFromId, route.fromPlace, sourceState);
    const routeToName = resolvePlaceName(routeToId, route.toPlace, sourceState);
    const idMatch = from.placeId && to.placeId && routeFromId === from.placeId && routeToId === to.placeId;
    const nameMatch = from.name && to.name && routeFromName === from.name && routeToName === to.name;
    return idMatch || nameMatch;
  });
  if (exact) return { ...exact, reverseFallback: false };

  const reverse = (sourceState.travelRoutes || []).find((route) => {
    const routeFromId = trimText(route.fromPlaceId);
    const routeToId = trimText(route.toPlaceId);
    const routeFromName = resolvePlaceName(routeFromId, route.fromPlace, sourceState);
    const routeToName = resolvePlaceName(routeToId, route.toPlace, sourceState);
    const idMatch = from.placeId && to.placeId && routeFromId === to.placeId && routeToId === from.placeId;
    const nameMatch = from.name && to.name && routeFromName === to.name && routeToName === from.name;
    return idMatch || nameMatch;
  });
  if (reverse) return { ...reverse, reverseFallback: true };

  return null;
}

export function buildMovementPlanLines(dateStr, schedules = [], sourceState = state) {
  const timed = (schedules || [])
    .map((item) => ({
      ...item,
      resolvedPlaceName: resolvePlaceName(item?.placeId, item?.placeName, sourceState)
    }))
    .filter((item) => !item?.allDay && trimText(item?.start) && trimText(item?.resolvedPlaceName))
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
    if (!trimText(current.resolvedPlaceName) || !trimText(next.resolvedPlaceName) || trimText(current.resolvedPlaceName) === trimText(next.resolvedPlaceName)) continue;

    const route = findBestTravelRoute(
      { placeId: current.placeId, placeName: current.resolvedPlaceName },
      { placeId: next.placeId, placeName: next.resolvedPlaceName },
      sourceState
    );
    if (!route) {
      lines.push(`${current.title} → ${next.title} / ${current.resolvedPlaceName} → ${next.resolvedPlaceName} / ルート未登録`);
      continue;
    }

    const travelMinutes = Number(route.durationMinutes || 0);
    const nextTrip = getNextTripInfo(route, current.endForMove, dateStr);
    const gapMinutes = Number.isFinite(toMinutes(next.start)) && Number.isFinite(toMinutes(current.endForMove))
      ? toMinutes(next.start) - toMinutes(current.endForMove)
      : NaN;

    const parts = [
      `${current.title} → ${next.title}`,
      `${current.resolvedPlaceName} → ${next.resolvedPlaceName}`,
      `${getTravelMethodLabel(route.method)} ${travelMinutes || '?'}分`
    ];

    if (nextTrip.departure) parts.push(`次発 ${nextTrip.departure}`);
    if (nextTrip.arrival) parts.push(`着 ${nextTrip.arrival}`);
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

export function sortTravelRoutesForDisplay(routes = state.travelRoutes || [], sourceState = state) {
  return [...(routes || [])].sort((a, b) => {
    const aKey = `${resolvePlaceName(a.fromPlaceId, a.fromPlace, sourceState)}${resolvePlaceName(a.toPlaceId, a.toPlace, sourceState)}${trimText(a.method)}`;
    const bKey = `${resolvePlaceName(b.fromPlaceId, b.fromPlace, sourceState)}${resolvePlaceName(b.toPlaceId, b.toPlace, sourceState)}${trimText(b.method)}`;
    return aKey.localeCompare(bKey, 'ja');
  });
}
