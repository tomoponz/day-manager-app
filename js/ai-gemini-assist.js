import { buildGeminiPlanningPrompt, parsePlanningDraftsResponse, replacePlanningDrafts, clearPlanningDrafts, deletePlanningDraft, applyPlanningDraft, applyAllPlanningDrafts } from './ai-drafts.js';
import { state } from './state.js';
import { formatDateInput } from './time.js';
import { renderAll } from './render.js';

const STATUS_CLASS = 'calendar-status';
const AI_SECTION_ID = 'geminiAssistSection';

boot();

async function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function init() {
  if (document.getElementById(AI_SECTION_ID)) return;
  const promptCard = document.getElementById('promptOutput')?.closest('.card');
  if (!promptCard) return;

  promptCard.insertAdjacentHTML('afterend', buildSectionHtml());
  bindEvents();
  renderPlanningDraftList();
  setStatus('Gemini提案JSONを読み込むと、ここからローカル予定や Google Calendar に反映できます。');
}

function bindEvents() {
  document.getElementById('generateGeminiPromptBtn')?.addEventListener('click', handleGeneratePrompt);
  document.getElementById('copyGeminiPromptBtn')?.addEventListener('click', handleCopyPrompt);
  document.getElementById('importAiDraftBtn')?.addEventListener('click', handleImportDrafts);
  document.getElementById('clearAiDraftInputBtn')?.addEventListener('click', handleClearInput);
  document.getElementById('applyAllDraftsLocalBtn')?.addEventListener('click', () => handleApplyAll(false));
  document.getElementById('applyAllDraftsGoogleBtn')?.addEventListener('click', () => handleApplyAll(true));
  document.getElementById('clearDraftsBtn')?.addEventListener('click', handleClearDrafts);
}

function handleGeneratePrompt() {
  const selectedDate = document.getElementById('selectedDate')?.value || formatDateInput(new Date());
  const textarea = document.getElementById('geminiPromptOutput');
  if (!textarea) return;
  textarea.value = buildGeminiPlanningPrompt(selectedDate);
  setStatus('Gemini向けのJSON指示を生成しました。', 'ok');
}

async function handleCopyPrompt() {
  const textarea = document.getElementById('geminiPromptOutput');
  if (!textarea) return;
  if (!textarea.value.trim()) handleGeneratePrompt();

  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    textarea.select();
    document.execCommand('copy');
  }
  setStatus('Gemini向けの指示をコピーしました。', 'ok');
}

function handleImportDrafts() {
  const input = document.getElementById('aiDraftInput');
  if (!input) return;
  const selectedDate = document.getElementById('selectedDate')?.value || formatDateInput(new Date());
  const result = parsePlanningDraftsResponse(input.value, selectedDate);
  if (!result.ok) {
    setStatus(result.error, 'warn');
    return;
  }

  replacePlanningDrafts(result.drafts);
  renderPlanningDraftList();
  document.getElementById('planningDraftPanel')?.setAttribute('open', '');
  setStatus(`AI提案を ${result.drafts.length} 件読み込みました。${result.skipped ? ` 読めなかった提案 ${result.skipped} 件。` : ''}`, result.skipped ? 'warn' : 'ok');
}

function handleClearInput() {
  const input = document.getElementById('aiDraftInput');
  if (input) input.value = '';
  setStatus('Gemini返答JSONの入力欄をクリアしました。');
}

async function handleApplyAll(syncToGoogle) {
  const result = await applyAllPlanningDrafts({ syncToGoogle });
  renderAll();
  renderPlanningDraftList();

  if (!result.ok && result.error) {
    setStatus(result.error, 'warn');
    return;
  }

  if (result.failed) {
    setStatus(`追加 ${result.applied} 件 / 重複 ${result.skipped} 件 / 失敗 ${result.failed} 件`, 'warn');
    return;
  }

  setStatus(`${syncToGoogle ? 'Google' : 'ローカル'}へ ${result.applied} 件追加しました。重複候補 ${result.skipped} 件はスキップしました。`, 'ok');
}

function handleClearDrafts() {
  clearPlanningDrafts();
  renderPlanningDraftList();
  setStatus('AI提案一覧をクリアしました。');
}

async function handleApplySingle(id, syncToGoogle) {
  const result = await applyPlanningDraft(id, { syncToGoogle });
  renderAll();
  renderPlanningDraftList();

  if (!result.ok) {
    setStatus(result.error || 'AI提案の反映に失敗しました。', 'warn');
    return;
  }
  if (result.skipped) {
    setStatus('重複候補のためスキップしました。', 'warn');
    return;
  }
  setStatus(`AI提案を${syncToGoogle ? 'Google Calendar' : 'ローカル予定'}に追加しました。`, 'ok');
}

function handleDeleteDraft(id) {
  deletePlanningDraft(id);
  renderPlanningDraftList();
  setStatus('AI提案を削除しました。');
}

function renderPlanningDraftList() {
  const wrap = document.getElementById('planningDraftList');
  if (!wrap) return;
  wrap.innerHTML = '';

  const items = [...(state.planningDrafts || [])].sort((a, b) => `${a.targetDate}${a.start}`.localeCompare(`${b.targetDate}${b.start}`));
  if (!items.length) {
    wrap.className = 'list-wrap empty';
    wrap.textContent = 'まだありません';
    return;
  }

  wrap.className = 'list-wrap';
  items.forEach((item) => wrap.appendChild(createDraftItem(item)));
}

function createDraftItem(item) {
  const article = document.createElement('article');
  article.className = 'list-item';

  const main = document.createElement('div');
  main.className = 'list-main';

  const title = document.createElement('strong');
  title.className = 'item-title';
  title.textContent = item.title;

  const meta = document.createElement('p');
  meta.className = 'item-meta';
  meta.textContent = `${item.targetDate || '日付未設定'} / ${item.allDay ? '終日' : item.start && item.end ? `${item.start} - ${item.end}` : '時刻未設定'} / ${draftStatusLabel(item.status)}`;

  const note = document.createElement('p');
  note.className = 'item-note';
  note.textContent = [item.note, item.reason ? `理由: ${item.reason}` : ''].filter(Boolean).join(' / ');

  main.appendChild(title);
  main.appendChild(meta);
  main.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'list-actions';

  if (item.status === 'draft' || item.status === 'failed') {
    actions.appendChild(makeButton('ローカル追加', () => handleApplySingle(item.id, false)));
    actions.appendChild(makeButton('Google追加', () => handleApplySingle(item.id, true)));
  }
  actions.appendChild(makeMiniButton('削除', () => handleDeleteDraft(item.id)));

  article.appendChild(main);
  article.appendChild(actions);
  return article;
}

function setStatus(message, variant = '') {
  const box = document.getElementById('aiDraftStatusBox');
  if (!box) return;
  box.textContent = message;
  box.className = STATUS_CLASS;
  if (variant) box.classList.add(variant);
}

function makeButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function makeMiniButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function draftStatusLabel(status) {
  return ({
    draft: '提案中',
    'applied-local': 'ローカル追加済',
    'applied-google': 'Google追加済',
    skipped: '重複スキップ',
    failed: '追加失敗'
  })[status] || status || '提案中';
}

function buildSectionHtml() {
  return `
    <section class="card" id="${AI_SECTION_ID}">
      <div class="card-header">
        <div>
          <h2>Gemini提案 → カレンダー反映</h2>
          <p>Gemini に貼るためのJSON指示を生成し、返ってきた提案JSONを読み込んでローカル予定または Google Calendar に追加します。</p>
        </div>
      </div>

      <div class="prompt-actions">
        <button id="generateGeminiPromptBtn" class="primary" type="button">Gemini向けJSON指示を生成</button>
        <button id="copyGeminiPromptBtn" type="button">コピー</button>
      </div>

      <label class="prompt-label">
        Geminiに貼る指示
        <textarea id="geminiPromptOutput" rows="16" placeholder="ここにGemini向け指示が生成されます"></textarea>
      </label>

      <details class="subsection-fold" id="aiDraftImportPanel" open>
        <summary class="subsection-summary">Gemini返答JSONを読み込む</summary>
        <div class="subsection-body">
          <p class="micro-note">Gemini の返答は JSON のみをそのまま貼り付けてください。 <code>proposedEvents</code> 配列を読み込みます。</p>
          <label class="prompt-label">
            Gemini返答JSON
            <textarea id="aiDraftInput" rows="12" placeholder='例: { &quot;proposedEvents&quot;: [ ... ] }'></textarea>
          </label>
          <div class="quick-add-actions">
            <button id="importAiDraftBtn" class="primary" type="button">AI提案JSONを読込</button>
            <button id="clearAiDraftInputBtn" class="ghost" type="button">入力欄をクリア</button>
          </div>
          <div id="aiDraftStatusBox" class="calendar-status">まだありません</div>
        </div>
      </details>

      <details class="subsection-fold" id="planningDraftPanel" open>
        <summary class="subsection-summary">AI提案一覧</summary>
        <div class="subsection-body">
          <div class="quick-add-actions">
            <button id="applyAllDraftsLocalBtn" type="button">まとめてローカル追加</button>
            <button id="applyAllDraftsGoogleBtn" class="primary" type="button">まとめてGoogle追加</button>
            <button id="clearDraftsBtn" class="ghost" type="button">提案を消す</button>
          </div>
          <p class="micro-note">最初は「まとめてローカル追加」で確認し、問題なければ Google へ追加するのが安全です。</p>
          <div id="planningDraftList" class="list-wrap empty">まだありません</div>
        </div>
      </details>
    </section>
  `;
}
