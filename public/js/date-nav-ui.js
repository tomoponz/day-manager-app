import { addDays, formatDateInput } from './time.js';

boot();

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function init() {
  const selectedDate = document.getElementById('selectedDate');
  if (!selectedDate) return;

  document.getElementById('prevDateBtn')?.addEventListener('click', () => moveSelectedDate(-1));
  document.getElementById('todayBtn')?.addEventListener('click', () => moveToToday());
  document.getElementById('nextDateBtn')?.addEventListener('click', () => moveSelectedDate(1));
}

function moveSelectedDate(diffDays) {
  const selectedDate = document.getElementById('selectedDate');
  if (!selectedDate) return;
  const base = selectedDate.value || formatDateInput(new Date());
  selectedDate.value = addDays(base, diffDays);
  selectedDate.dispatchEvent(new Event('change', { bubbles: true }));
}

function moveToToday() {
  const selectedDate = document.getElementById('selectedDate');
  if (!selectedDate) return;
  selectedDate.value = formatDateInput(new Date());
  selectedDate.dispatchEvent(new Event('change', { bubbles: true }));
}
