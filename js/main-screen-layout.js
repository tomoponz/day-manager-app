boot();

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

function init() {
  normalizeListTemplate();
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