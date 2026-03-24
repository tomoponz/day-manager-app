boot();

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function init() {
  ensureTodayListSection();
  normalizeListTemplate();
}

function ensureTodayListSection() {
  const main = document.querySelector('main.container');
  const stateSection = Array.from(document.querySelectorAll('main.container > section, main.container > details')).find((section) =>
    section.querySelector('#currentStateSummary')
  );

  if (!main || !stateSection) return;
  if (document.getElementById('todayListSection')) {
    moveListsIntoMainSection();
    return;
  }

  const wrapper = document.createElement('section');
  wrapper.className = 'card';
  wrapper.id = 'todayListSection';
  wrapper.innerHTML = `
    <div class="card-header">
      <div>
        <h2>今日の一覧</h2>
        <p>固定予定・単発予定・タスクの本体一覧を、主画面で直接確認します。</p>
      </div>
    </div>

    <div class="grid two-col">
      <section class="card">
        <div class="card-header compact">
          <div>
            <h2>固定予定</h2>
            <p>毎週くり返す授業・通学・食事など</p>
          </div>
        </div>
        <div class="main-list-slot" data-list-target="fixedList"></div>
      </section>
      <section class="card">
        <div class="card-header compact">
          <div>
            <h2>単発予定</h2>
            <p>その日だけの予定・締切・外出など</p>
          </div>
        </div>
        <div class="main-list-slot" data-list-target="eventList"></div>
      </section>
    </div>

    <section class="card">
      <div class="card-header compact">
        <div>
          <h2>タスク</h2>
          <p>課題・復習・生活タスクなど。締切と見積時間を持たせます。</p>
        </div>
      </div>
      <div class="main-list-slot" data-list-target="taskList"></div>
    </section>
  `;

  main.insertBefore(wrapper, stateSection);
  moveListsIntoMainSection();
}

function moveListsIntoMainSection() {
  ["fixedList", "eventList", "taskList"].forEach((id) => {
    const list = document.getElementById(id);
    const slot = document.querySelector(`.main-list-slot[data-list-target="${id}"]`);
    if (!list || !slot || slot.contains(list)) return;
    slot.appendChild(list);
  });
}

function normalizeListTemplate() {
  const template = document.getElementById('listItemTemplate');
  if (!template) return;
  const content = template.content;
  const listMain = content.querySelector('.list-main');
  if (!listMain) return;

  const meta = content.querySelector('.item-meta');
  if (meta && meta.tagName !== 'DIV') {
    const newMeta = document.createElement('div');
    newMeta.className = 'item-meta';
    meta.replaceWith(newMeta);
  }

  if (!content.querySelector('.item-detail')) {
    const detail = document.createElement('p');
    detail.className = 'item-detail';
    const note = content.querySelector('.item-note');
    if (note) listMain.insertBefore(detail, note);
    else listMain.appendChild(detail);
  }
}
