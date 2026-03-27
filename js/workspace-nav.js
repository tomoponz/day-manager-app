import { resizeCalendarUi, refreshCalendarUi } from './calendar-ui.js';

const STORAGE_KEY = 'day-manager-workspace-nav-v2';
const NORMAL_MODE = 'normal';
const FOCUS_MODE = 'focus';

boot();

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function init() {
  const nav = document.getElementById('workspaceNav');
  if (!nav) return;

  const sections = Array.from(document.querySelectorAll("[data-workspace-section='primary']"));
  const tabs = Array.from(nav.querySelectorAll('[data-workspace-target]'));
  const utilityButtons = Array.from(nav.querySelectorAll('[data-utility-target]'));
  const modeSelect = document.getElementById('workspaceModeSelect');
  const prevBtn = document.getElementById('workspacePrevBtn');
  const nextBtn = document.getElementById('workspaceNextBtn');
  const modeNote = document.getElementById('workspaceModeNote');
  if (!sections.length || !tabs.length || !modeSelect || !prevBtn || !nextBtn) return;

  const state = loadPrefs(sections, tabs);
  let observer = null;

  const activateSection = (targetId, options = {}) => {
    const { userInitiated = false, skipScroll = false } = options;
    const target = sections.find((section) => section.id === targetId) || sections[0];
    if (!target) return;

    state.activeSectionId = target.id;
    tabs.forEach((tab) => {
      const isActive = tab.dataset.workspaceTarget === target.id;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });
    sections.forEach((section) => {
      section.classList.toggle('workspace-section-active', section.id === target.id);
    });

    updateStepButtons();
    updateModeNote(modeNote, state.mode);
    savePrefs(state);

    if (state.mode === FOCUS_MODE) {
      if (userInitiated && !skipScroll) scrollNavIntoView(nav);
      requestCalendarRefresh(target.id);
      return;
    }
    if (userInitiated && !skipScroll) {
      scrollToNode(target);
    }
  };

  const openUtilityPanel = (panelId) => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (panel.tagName === 'DETAILS') panel.open = true;
    const nestedSummary = panel.querySelector('summary');
    if (nestedSummary && panel.tagName !== 'DETAILS') {
      nestedSummary.setAttribute('aria-expanded', 'true');
    }
    scrollToNode(panel);
  };

  window.workspaceNavApi = { activateSection, openUtilityPanel };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.workspaceTarget;
      if (!targetId) return;
      activateSection(targetId, { userInitiated: true });
    });
  });

  utilityButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.utilityTarget;
      if (!targetId) return;
      openUtilityPanel(targetId);
    });
  });

  modeSelect.addEventListener('change', () => {
    state.mode = modeSelect.value === FOCUS_MODE ? FOCUS_MODE : NORMAL_MODE;
    document.body.classList.toggle('workspace-focus-mode', state.mode === FOCUS_MODE);
    updateModeNote(modeNote, state.mode);
    syncStickyOffsets(nav);
    setupObserver();
    savePrefs(state);
    requestCalendarRefresh(state.activeSectionId);
  });

  prevBtn.addEventListener('click', () => stepSection(-1));
  nextBtn.addEventListener('click', () => stepSection(1));
  window.addEventListener('resize', () => syncStickyOffsets(nav), { passive: true });

  function stepSection(delta) {
    const currentIndex = Math.max(0, sections.findIndex((section) => section.id === state.activeSectionId));
    const nextIndex = clamp(currentIndex + delta, 0, sections.length - 1);
    activateSection(sections[nextIndex].id, { userInitiated: true });
  }

  function updateStepButtons() {
    const currentIndex = sections.findIndex((section) => section.id === state.activeSectionId);
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex < 0 || currentIndex >= sections.length - 1;
  }

  function setupObserver() {
    observer?.disconnect();
    if (state.mode === FOCUS_MODE || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const nextId = visible[0].target.id;
      if (!nextId || nextId === state.activeSectionId) return;
      activateSection(nextId, { skipScroll: true });
    }, {
      threshold: [0.2, 0.35, 0.5],
      rootMargin: `-${getStickyOffset()}px 0px -45% 0px`
    });
    sections.forEach((section) => observer.observe(section));
  }

  modeSelect.value = state.mode;
  document.body.classList.toggle('workspace-focus-mode', state.mode === FOCUS_MODE);
  syncStickyOffsets(nav);
  activateSection(state.activeSectionId, { skipScroll: true });
  setupObserver();
  requestAnimationFrame(() => syncStickyOffsets(nav));
}

function requestCalendarRefresh(targetId) {
  if (targetId !== 'proCalendarSection') return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      resizeCalendarUi();
      refreshCalendarUi();
    });
  });
}

function scrollToNode(node) {
  const top = node.getBoundingClientRect().top + window.scrollY - getStickyOffset() - 14;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function scrollNavIntoView(nav) {
  const topbarHeight = document.querySelector('.topbar')?.offsetHeight || 0;
  const top = nav.getBoundingClientRect().top + window.scrollY - topbarHeight - 8;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function syncStickyOffsets(nav) {
  const topbarHeight = document.querySelector('.topbar')?.offsetHeight || 0;
  const navHeight = nav?.offsetHeight || 0;
  document.documentElement.style.setProperty('--topbar-height', `${topbarHeight}px`);
  document.documentElement.style.setProperty('--workspace-nav-height', `${navHeight}px`);
}

function getStickyOffset() {
  const topbarHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height')) || 0;
  const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-nav-height')) || 0;
  return topbarHeight + navHeight;
}

function loadPrefs(sections, tabs) {
  const fallbackId = tabs[0]?.dataset.workspaceTarget || sections[0]?.id || '';
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const activeSectionId = sections.some((section) => section.id === parsed.activeSectionId)
      ? parsed.activeSectionId
      : fallbackId;
    const mode = parsed.mode === FOCUS_MODE ? FOCUS_MODE : NORMAL_MODE;
    return { activeSectionId, mode };
  } catch {
    return { activeSectionId: fallbackId, mode: NORMAL_MODE };
  }
}

function savePrefs(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function updateModeNote(target, mode) {
  if (!target) return;
  target.textContent = mode === FOCUS_MODE
    ? '集中: 主導線4画面だけを切り替えて、縦スクロールをほぼ不要にします。学習管理と設定は右側ボタンから開きます。'
    : '通常: 全体を見ながら移動します。学習管理と設定は右側ボタンから開きます。';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
