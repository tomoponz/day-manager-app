import { state, saveState } from "./state.js";

const SETTINGS_DEFS = [
  { key: "protectLunch", type: "boolean" },
  { key: "lunchWindowStart", type: "time" },
  { key: "lunchWindowEnd", type: "time" },
  { key: "lunchMinutes", type: "number", min: 20, max: 180 },
  { key: "breakAfterEvent", type: "boolean" },
  { key: "breakMinutes", type: "number", min: 5, max: 60 },
  { key: "protectFocusBlock", type: "boolean" },
  { key: "focusBlockMinutes", type: "number", min: 30, max: 240 },
  { key: "aiDraftOnly", type: "boolean" },
  { key: "confirmBeforeGoogleApply", type: "boolean" }
];

const DEFAULTS = {
  protectLunch: true,
  lunchWindowStart: "12:00",
  lunchWindowEnd: "13:30",
  lunchMinutes: 45,
  breakAfterEvent: true,
  breakMinutes: 15,
  protectFocusBlock: false,
  focusBlockMinutes: 90,
  aiDraftOnly: true,
  confirmBeforeGoogleApply: true
};

const ui = {
  getGoogleConnected: () => false,
  onConnectGoogle: null,
  onDisconnectGoogle: null
};

let currentStep = 1;
let initialized = false;

export function initializeOnboarding(callbacks = {}) {
  Object.assign(ui, callbacks);
  ensureShell();
  bindEventsOnce();
  syncControlsFromState();
  refreshGoogleStatus();
  updateOnboardingStatusText();

  if (!state.uiState?.onboardingCompleted) {
    openOnboarding(state.uiState?.onboardingStep || 1);
  }
}

export function openOnboarding(step = 1) {
  ensureShell();
  currentStep = clampStep(step);
  state.uiState.onboardingStep = currentStep;
  saveState();
  syncControlsFromState();
  refreshGoogleStatus();
  renderStep();
  document.body.classList.add("onboarding-open");
  document.getElementById("onboardingOverlay")?.classList.add("is-open");
}

function closeOnboarding({ complete = false } = {}) {
  if (complete) {
    state.uiState.onboardingCompleted = true;
  }
  state.uiState.onboardingStep = currentStep;
  saveState();
  updateOnboardingStatusText();
  document.body.classList.remove("onboarding-open");
  document.getElementById("onboardingOverlay")?.classList.remove("is-open");
}

function ensureShell() {
  ensureOnboardingOverlay();
  ensureRulesMount();
  ensureAiPolicyMount();
}

function ensureOnboardingOverlay() {
  const mount = document.getElementById("onboardingMount");
  if (!mount || mount.dataset.ready === "1") return;
  mount.innerHTML = buildOverlayHtml();
  mount.dataset.ready = "1";
}

function ensureRulesMount() {
  const mount = document.getElementById("ruleSettingsMount");
  if (!mount || mount.dataset.ready === "1") return;
  mount.innerHTML = buildRulesHtml("settings");
  mount.dataset.ready = "1";
}

function ensureAiPolicyMount() {
  const mount = document.getElementById("aiPolicyMount");
  if (!mount || mount.dataset.ready === "1") return;
  mount.innerHTML = buildPolicyHtml("settings");
  mount.dataset.ready = "1";

  const onboardingRulesMount = document.getElementById("onboardingRulesMount");
  if (onboardingRulesMount && onboardingRulesMount.dataset.ready !== "1") {
    onboardingRulesMount.innerHTML = buildRulesHtml("onboarding");
    onboardingRulesMount.dataset.ready = "1";
  }

  const onboardingPolicyMount = document.getElementById("onboardingPolicyMount");
  if (onboardingPolicyMount && onboardingPolicyMount.dataset.ready !== "1") {
    onboardingPolicyMount.innerHTML = buildPolicyHtml("onboarding");
    onboardingPolicyMount.dataset.ready = "1";
  }
}

function bindEventsOnce() {
  if (initialized) return;
  initialized = true;

  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleSettingInput);
  document.addEventListener("change", handleSettingInput);
  window.addEventListener("focus", refreshGoogleStatus);
}

function handleClick(event) {
  const target = event.target.closest("button, .onboarding-overlay__backdrop");
  if (!target) return;

  if (target.id === "openOnboardingBtn") {
    openOnboarding(state.uiState?.onboardingStep || 1);
    return;
  }

  if (target.classList.contains("onboarding-overlay__backdrop") || target.dataset.onboardingAction === "close") {
    closeOnboarding();
    return;
  }

  if (target.dataset.onboardingAction === "skip") {
    closeOnboarding();
    return;
  }

  if (target.dataset.onboardingAction === "back") {
    currentStep = clampStep(currentStep - 1);
    state.uiState.onboardingStep = currentStep;
    saveState();
    renderStep();
    return;
  }

  if (target.dataset.onboardingAction === "next") {
    currentStep = clampStep(currentStep + 1);
    state.uiState.onboardingStep = currentStep;
    saveState();
    renderStep();
    return;
  }

  if (target.dataset.onboardingAction === "complete") {
    closeOnboarding({ complete: true });
    return;
  }

  if (target.id === "onboardingConnectGoogleBtn") {
    ui.onConnectGoogle?.();
    return;
  }

  if (target.id === "onboardingDisconnectGoogleBtn") {
    ui.onDisconnectGoogle?.();
    setTimeout(refreshGoogleStatus, 250);
  }
}

function handleSettingInput(event) {
  const input = event.target.closest("[data-setting-key]");
  if (!input) return;

  const key = input.dataset.settingKey;
  const def = SETTINGS_DEFS.find((item) => item.key === key);
  if (!def) return;

  state.settings[key] = readInputValue(input, def);
  saveState();
  syncControlsFromState(key);
  updateOnboardingStatusText();
}

function readInputValue(input, def) {
  if (def.type === "boolean") {
    return Boolean(input.checked);
  }

  if (def.type === "number") {
    const number = Number(input.value);
    if (!Number.isFinite(number)) return DEFAULTS[def.key];
    const min = Number.isFinite(def.min) ? def.min : number;
    const max = Number.isFinite(def.max) ? def.max : number;
    return Math.min(max, Math.max(min, number));
  }

  if (def.type === "time") {
    const text = String(input.value || "").trim();
    return /^\d{2}:\d{2}$/.test(text) ? text : DEFAULTS[def.key];
  }

  return input.value;
}

function syncControlsFromState(changedKey = "") {
  SETTINGS_DEFS.forEach((def) => {
    if (changedKey && def.key !== changedKey) {
      // still continue to update dependent disabled states
    }
    document.querySelectorAll(`[data-setting-key="${def.key}"]`).forEach((input) => {
      const value = state.settings?.[def.key];
      if (def.type === "boolean") {
        input.checked = Boolean(value);
      } else {
        input.value = value ?? DEFAULTS[def.key];
      }
    });
  });

  toggleDisabledGroup("lunch", !state.settings?.protectLunch);
  toggleDisabledGroup("break", !state.settings?.breakAfterEvent);
  toggleDisabledGroup("focus", !state.settings?.protectFocusBlock);

  const openNote = document.getElementById("onboardingOpenNote");
  if (openNote) {
    openNote.textContent = state.uiState?.onboardingCompleted
      ? "セットアップは完了済みです。必要なときだけ開き直してください。"
      : "セットアップはまだ未完了です。必要なところだけ先に決めても構いません。";
  }
}

function toggleDisabledGroup(groupName, disabled) {
  document.querySelectorAll(`[data-rule-group="${groupName}"]`).forEach((group) => {
    group.classList.toggle("is-disabled", disabled);
    group.querySelectorAll("input, select").forEach((field) => {
      field.disabled = disabled;
    });
  });
}

function refreshGoogleStatus() {
  const connected = Boolean(ui.getGoogleConnected?.());
  const status = document.getElementById("onboardingGoogleStatus");
  if (!status) return;
  status.className = "onboarding-google-status";
  status.classList.add(connected ? "is-ok" : "is-warn");
  status.innerHTML = connected
    ? `<strong>Google Calendar は接続済みです。</strong><div class="micro-note">このまま対象日の予定取得と単発予定の同期が使えます。</div>`
    : `<strong>Google Calendar は未接続です。</strong><div class="micro-note">今はスキップして、あとで「AI・連携」から接続しても構いません。</div>`;
}

function updateOnboardingStatusText() {
  const status = document.getElementById("onboardingStatusText");
  if (!status) return;
  const completed = Boolean(state.uiState?.onboardingCompleted);
  status.textContent = completed
    ? "セットアップ完了 / あとから再設定できます"
    : `未完了 / Step ${state.uiState?.onboardingStep || 1} から再開`;
}

function renderStep() {
  document.querySelectorAll("[data-onboarding-step-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", Number(panel.dataset.onboardingStepPanel) === currentStep);
  });

  document.querySelectorAll(".onboarding-step-chip").forEach((chip) => {
    const step = Number(chip.dataset.step);
    chip.classList.toggle("is-active", step === currentStep);
    chip.classList.toggle("is-complete", Boolean(state.uiState?.onboardingCompleted) || step < currentStep);
  });

  const title = document.getElementById("onboardingStepTitle");
  const copy = document.getElementById("onboardingStepCopy");
  const badge = document.getElementById("onboardingStepBadge");
  const back = document.getElementById("onboardingBackBtn");
  const next = document.getElementById("onboardingNextBtn");
  const complete = document.getElementById("onboardingCompleteBtn");

  const map = {
    1: {
      title: "Google Calendar を接続する",
      copy: "まず接続の有無だけ確認します。未接続でも後から進められます。"
    },
    2: {
      title: "時間を守る基本ルールを決める",
      copy: "昼休み・休憩・集中時間を守るかを先に決めておくと、AI提案がぶれにくくなります。"
    },
    3: {
      title: "AIの扱いを安全側に固定する",
      copy: "このアプリでは、AI提案は draft に止めてから人間が確認して反映する運用を前提にします。"
    }
  };

  if (title) title.textContent = map[currentStep].title;
  if (copy) copy.textContent = map[currentStep].copy;
  if (badge) badge.textContent = `Step ${currentStep} / 3`;
  if (back) back.hidden = currentStep === 1;
  if (next) next.hidden = currentStep === 3;
  if (complete) complete.hidden = currentStep !== 3;
}

function clampStep(step) {
  return Math.max(1, Math.min(3, Number(step) || 1));
}

function buildOverlayHtml() {
  return `
    <div class="onboarding-overlay" id="onboardingOverlay" aria-hidden="true">
      <div class="onboarding-overlay__backdrop" data-onboarding-action="close"></div>
      <section class="onboarding-overlay__panel" role="dialog" aria-modal="true" aria-labelledby="onboardingMainTitle">
        <div class="onboarding-shell">
          <aside class="onboarding-aside">
            <p class="eyebrow">Setup / Rules / AI draft-first</p>
            <h2 class="onboarding-title" id="onboardingMainTitle">Day Manager の初回セットアップ</h2>
            <p class="onboarding-copy">Reclaim 的な「時間を守る設定」だけを最初に決めます。最初から全部使い切る必要はありません。</p>
            <div class="onboarding-steps">
              ${buildStepChip(1, "Google接続", "予定取得と単発予定の同期を使う準備")}
              ${buildStepChip(2, "時間防衛ルール", "昼休み・休憩・集中時間の基本方針")}
              ${buildStepChip(3, "AI運用方針", "AIは draft まで、人間が確認して反映")}
            </div>
          </aside>
          <div class="onboarding-main">
            <div class="onboarding-header">
              <div>
                <div class="onboarding-status-chip" id="onboardingStepBadge">Step 1 / 3</div>
                <h2 id="onboardingStepTitle">Google Calendar を接続する</h2>
                <p id="onboardingStepCopy">まず接続の有無だけ確認します。未接続でも後から進められます。</p>
              </div>
              <button class="ghost onboarding-close" data-onboarding-action="close" type="button">閉じる</button>
            </div>
            <div class="onboarding-content">
              <section class="onboarding-step-panel" data-onboarding-step-panel="1">
                <div class="onboarding-google-status" id="onboardingGoogleStatus"></div>
                <div class="onboarding-google-actions">
                  <button class="primary" id="onboardingConnectGoogleBtn" type="button">Googleで接続</button>
                  <button class="ghost" id="onboardingDisconnectGoogleBtn" type="button">接続解除</button>
                </div>
                <div class="onboarding-callout">
                  <strong>ここで決めること</strong>
                  <div>接続済みならそのまま次へ。未接続でもスキップ可能ですが、Google予定読込と単発予定同期は使えません。</div>
                </div>
              </section>
              <section class="onboarding-step-panel" data-onboarding-step-panel="2">
                <div class="onboarding-callout">
                  <strong>まず守る時間を決める</strong>
                  <div>この段階では、まだ自動確定はしません。昼休み・休憩・集中時間を「候補ブロック」として扱う準備だけを行います。</div>
                </div>
                <div id="onboardingRulesMount"></div>
              </section>
              <section class="onboarding-step-panel" data-onboarding-step-panel="3">
                <div class="onboarding-callout">
                  <strong>AI は補助に止める</strong>
                  <div>Gemini や ChatGPT は、まず draft 提案を作るところまで。Google へ入れる前には必ず人間が確認します。</div>
                </div>
                <div id="onboardingPolicyMount"></div>
              </section>
            </div>
            <div class="onboarding-footer">
              <div class="onboarding-footer__left">
                <button class="ghost" data-onboarding-action="skip" type="button">あとで</button>
                <span class="micro-note" id="onboardingOpenNote">セットアップはまだ未完了です。必要なところだけ先に決めても構いません。</span>
              </div>
              <div class="onboarding-footer__right">
                <button class="ghost" hidden id="onboardingBackBtn" data-onboarding-action="back" type="button">戻る</button>
                <button class="primary" id="onboardingNextBtn" data-onboarding-action="next" type="button">次へ</button>
                <button class="primary" hidden id="onboardingCompleteBtn" data-onboarding-action="complete" type="button">この設定で始める</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function buildStepChip(step, label, detail) {
  return `
    <div class="onboarding-step-chip" data-step="${step}">
      <div class="onboarding-step-chip__index">${step}</div>
      <div>
        <div class="onboarding-step-chip__label">${label}</div>
        <div class="onboarding-step-chip__detail">${detail}</div>
      </div>
    </div>
  `;
}

function buildRulesHtml(scope) {
  return `
    <div class="rules-stack" data-rules-scope="${scope}">
      <section class="rule-card">
        <label class="rule-card__toggle">
          <input type="checkbox" data-setting-key="protectLunch">
          <span>
            <span class="rule-card__title">平日昼休みを守る</span>
            <span class="rule-card__detail">昼の空き時間を食事・休憩として守る前提を先に置きます。</span>
          </span>
        </label>
        <div class="rule-card__fields" data-rule-group="lunch">
          <div class="rule-grid">
            <label>候補開始<input type="time" data-setting-key="lunchWindowStart"></label>
            <label>候補終了<input type="time" data-setting-key="lunchWindowEnd"></label>
            <label>確保分数<input type="number" min="20" max="180" step="5" data-setting-key="lunchMinutes"></label>
          </div>
        </div>
      </section>

      <section class="rule-card">
        <label class="rule-card__toggle">
          <input type="checkbox" data-setting-key="breakAfterEvent">
          <span>
            <span class="rule-card__title">予定のあとに休憩を入れる</span>
            <span class="rule-card__detail">会議・面談・外出の直後に短い回復時間を差し込む前提にします。</span>
          </span>
        </label>
        <div class="rule-card__fields" data-rule-group="break">
          <div class="rule-grid rule-grid--two">
            <label>休憩分数<input type="number" min="5" max="60" step="5" data-setting-key="breakMinutes"></label>
            <div class="onboarding-callout">
              <strong>使いどころ</strong>
              <div>長い予定が連続した日でも、再設計時に「詰め込みすぎ」を避けやすくなります。</div>
            </div>
          </div>
        </div>
      </section>

      <section class="rule-card">
        <label class="rule-card__toggle">
          <input type="checkbox" data-setting-key="protectFocusBlock">
          <span>
            <span class="rule-card__title">深い集中時間を守る</span>
            <span class="rule-card__detail">課題・制作・重い処理用に、まとまった集中ブロックを候補として確保します。</span>
          </span>
        </label>
        <div class="rule-card__fields" data-rule-group="focus">
          <div class="rule-grid rule-grid--two">
            <label>集中ブロック分数<input type="number" min="30" max="240" step="10" data-setting-key="focusBlockMinutes"></label>
            <div class="onboarding-callout">
              <strong>最初は控えめで十分</strong>
              <div>まずは 60〜90 分から。重すぎると逆に自動時間割が窮屈になります。</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function buildPolicyHtml(scope) {
  return `
    <div class="policy-stack" data-policy-scope="${scope}">
      <label class="policy-row">
        <input type="checkbox" data-setting-key="aiDraftOnly">
        <span>
          <span class="policy-row__title">AI提案は draft までに止める</span>
          <span class="policy-row__detail">Gemini や ChatGPT の結果を即時反映せず、まず提案一覧で確認する運用にします。</span>
        </span>
      </label>
      <label class="policy-row">
        <input type="checkbox" data-setting-key="confirmBeforeGoogleApply">
        <span>
          <span class="policy-row__title">Google 反映前に必ず確認する</span>
          <span class="policy-row__detail">単発予定の Google 追加は、人間が最後に確認してから実行する前提に固定します。</span>
        </span>
      </label>
    </div>
  `;
}
