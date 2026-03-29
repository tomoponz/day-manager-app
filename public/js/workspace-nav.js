import { resizeCalendarUi, refreshCalendarUi } from './calendar-ui.js';

const STORAGE_KEY = 'day-manager-workspace-nav-v4';
const NORMAL_MODE = 'normal';
const FOCUS_MODE = 'focus';
const COMPACT_SCROLL_Y = 32;

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

  const drawer = document.getElementById('quickAddDrawer');
  const drawerOpeners = Array.from(document.querySelectorAll('[data-open-quick-add]'));
  const drawerClosers = Array.from(document.querySelectorAll('[data-close-quick-add]'));
  const sections = Array.from(document.querySelectorAll("[data-workspace-section='primary']"));
  const tabs = Array.from(nav.querySelectorAll('[data-workspace-target]'));
  const utilityButtons = Array.from(nav.querySelectorAll('[data-utility-target]'));
  const modeToggle = document.getElementById('workspaceModeToggle');
  const prevBtn = document.getElementById('workspacePrevBtn');
  const nextBtn = document.getElementById('workspaceNextBtn');
  if (!sections.length || !tabs.length || !modeToggle || !prevBtn || !nextBtn) return;

  const prefs = loadPrefs(sections, tabs);
  let observer = null;

  const activateSection = (targetId, options = {}) => {
    const { userInitiated = false, skipScroll = false } = options;
    const target = sections.find((section) => section.id === targetId) || sections[0];
    if (!target) return;

    closeQuickAddDrawer({ restoreFocus: false });
    prefs.activeSectionId = target.id;
    tabs.forEach((tab) => {
      const isActive = tab.dataset.workspaceTarget === target.id;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-pressed', String(isActive));
    });
    sections.forEach((section) => {
      section.classList.toggle('workspace-section-active', section.id === target.id);
    });

    updateStepButtons();
    syncModeUi();
    savePrefs(prefs);

    if (prefs.mode === FOCUS_MODE) {
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
    openAncestorDetails(panel);
    if (panel.tagName === 'DETAILS') panel.open = true;
    scrollToNode(panel);
  };

  window.workspaceNavApi = { activateSection, openUtilityPanel, openQuickAddDrawer };

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

  drawerOpeners.forEach((button) => button.addEventListener('click', openQuickAddDrawer));
  drawerClosers.forEach((button) => button.addEventListener('click', () => closeQuickAddDrawer()));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeQuickAddDrawer();
  });

  modeToggle.addEventListener('click', () => {
    prefs.mode = prefs.mode === FOCUS_MODE ? NORMAL_MODE : FOCUS_MODE;
    document.body.classList.toggle('workspace-focus-mode', prefs.mode === FOCUS_MODE);
    syncModeUi();
    syncStickyOffsets(nav);
    setupObserver();
    savePrefs(prefs);
    requestCalendarRefresh(prefs.activeSectionId);
  });

  prevBtn.addEventListener('click', () => stepSection(-1));
  nextBtn.addEventListener('click', () => stepSection(1));

  window.addEventListener('resize', () => syncStickyOffsets(nav), { passive: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => syncStickyOffsets(nav)).catch(() => {});
  }
  bindChromeCompaction(nav);

  function stepSection(delta) {
    const currentIndex = Math.max(0, sections.findIndex((section) => section.id === prefs.activeSectionId));
    const nextIndex = clamp(currentIndex + delta, 0, sections.length - 1);
    activateSection(sections[nextIndex].id, { userInitiated: true });
  }

  function updateStepButtons() {
    const currentIndex = sections.findIndex((section) => section.id === prefs.activeSectionId);
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex < 0 || currentIndex >= sections.length - 1;
  }

  function setupObserver() {
    observer?.disconnect();
    if (prefs.mode === FOCUS_MODE || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const nextId = visible[0].target.id;
      if (!nextId || nextId === prefs.activeSectionId) return;
      activateSection(nextId, { skipScroll: true });
    }, {
      threshold: [0.2, 0.35, 0.5],
      rootMargin: `-${getStickyOffset()}px 0px -45% 0px`
    });
    sections.forEach((section) => observer.observe(section));
  }

  function openQuickAddDrawer() {
    if (!drawer) return;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('quick-add-open');
    syncStickyOffsets(nav);
    window.setTimeout(() => {
      drawer.querySelector('#quickAddInput')?.focus();
    }, 30);
  }

  function closeQuickAddDrawer({ restoreFocus = true } = {}) {
    if (!drawer || !drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('quick-add-open');
    syncStickyOffsets(nav);
    if (restoreFocus) {
      drawerOpeners[0]?.focus();
    }
  }

  function syncModeUi() {
    const isFocus = prefs.mode === FOCUS_MODE;
    document.body.classList.toggle('workspace-focus-mode', isFocus);
    modeToggle.classList.toggle('is-active', isFocus);
    modeToggle.setAttribute('aria-pressed', String(isFocus));
    modeToggle.textContent = isFocus ? '通常表示' : '集中表示';
  }

  syncModeUi();
  syncStickyOffsets(nav);
  activateSection(prefs.activeSectionId, { skipScroll: true });
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


function openAncestorDetails(node) {
  let current = node.parentElement;
  while (current) {
    if (current.tagName === 'DETAILS') current.open = true;
    current = current.parentElement;
  }
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

function bindChromeCompaction(nav) {
  let ticking = false;

  const applyChromeDensity = () => {
    document.body.classList.toggle('workspace-chrome-compact', window.scrollY > COMPACT_SCROLL_Y);
    syncStickyOffsets(nav);
    ticking = false;
  };

  const requestApply = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(applyChromeDensity);
  };

  window.addEventListener('scroll', requestApply, { passive: true });
  applyChromeDensity();
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
