const state = { csrf: '', works: [], filter: 'all', editing: null };
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (state.csrf && !['GET', 'HEAD'].includes(options.method || 'GET')) headers.set('X-CSRF-Token', state.csrf);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showLogin();
    throw new Error(data.error || '操作失败，请重试。');
  }
  return data;
}

function showLogin() {
  state.csrf = '';
  $('#login-card').hidden = false; $('#dashboard').hidden = true; $('#admin-user').hidden = true;
}

function showDashboard(admin) {
  $('#login-card').hidden = true; $('#dashboard').hidden = false; $('#admin-user').hidden = false;
  $('#username').textContent = admin.username;
}

const statusLabels = { published: '已发布', draft: '草稿', archived: '已下架' };

function renderList() {
  const list = $('#work-list');
  const works = state.filter === 'all' ? state.works : state.works.filter((work) => work.status === state.filter);
  if (!works.length) { list.innerHTML = '<div class="empty">这个分类下还没有内容。</div>'; return; }
  list.innerHTML = works.map((work) => `<article class="work-row">
    <div class="issue-badge">${escapeHtml(work.issueNumber || '—')}</div>
    <div><h3>${escapeHtml(work.title)}<span class="status ${work.status}">${statusLabels[work.status]}</span></h3><p>更新于 ${escapeHtml(new Date(work.updatedAt).toLocaleString('zh-CN'))}${work.audioUrl ? ' · 已上传音频' : ' · 暂无音频'}</p></div>
    <div class="row-actions">
      <button class="secondary-action" data-edit="${work.id}" type="button">编辑</button>
      ${work.status === 'published' ? `<button class="secondary-action" data-status="archived" data-id="${work.id}" type="button">下架</button>` : `<button class="secondary-action" data-status="published" data-id="${work.id}" type="button">发布</button>`}
      <button class="danger-action" data-delete="${work.id}" type="button">删除</button>
    </div></article>`).join('');
}

async function loadWorks() {
  state.works = (await request('/api/admin/works')).works;
  renderList();
}

function localDatetime(value) {
  if (!value) return '';
  const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function openEditor(work = null) {
  state.editing = work;
  $('#work-form').reset();
  $('#work-id').value = work?.id || '';
  $('#issue-number').value = work?.issueNumber || '';
  $('#published-at').value = localDatetime(work?.publishedAt);
  $('#title').value = work?.title || '';
  $('#slug').value = work?.slug || '';
  $('#host').value = work?.host || '';
  $('#guest').value = work?.guest || '';
  $('#excerpt').value = work?.excerpt || '';
  $('#content-editor').innerHTML = work?.contentHtml || '<p></p>';
  $('#cover-note').textContent = work?.coverUrl ? '已有封面；选择新文件将替换' : 'JPG / PNG / WebP / GIF，建议不超过 10MB';
  $('#audio-note').textContent = work?.audioOriginalName ? `已有音频：${work.audioOriginalName}；选择新文件将替换` : 'MP3 / M4A / WAV / OGG / WebM，不超过 80MB';
  $('#editor-title').textContent = work ? '编辑作品' : '新建作品';
  $('#editor-error').textContent = '';
  $('#editor-overlay').hidden = false; document.body.classList.add('no-scroll');
}

function closeEditor() { $('#editor-overlay').hidden = true; document.body.classList.remove('no-scroll'); state.editing = null; }

async function saveWork(status) {
  const form = $('#work-form');
  if (!form.reportValidity()) return;
  const body = new FormData(form);
  body.set('contentHtml', $('#content-editor').innerHTML);
  body.set('status', status);
  const id = $('#work-id').value;
  const panel = $('.editor-panel'); panel.classList.add('busy'); $('#editor-error').textContent = '';
  try {
    await request(id ? `/api/admin/works/${id}` : '/api/admin/works', { method: id ? 'PUT' : 'POST', body });
    closeEditor(); await loadWorks(); toast(status === 'published' ? '内容已发布。' : status === 'draft' ? '草稿已保存。' : '内容已保存并下架。');
  } catch (error) { $('#editor-error').textContent = error.message; }
  finally { panel.classList.remove('busy'); }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const data = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    state.csrf = data.csrfToken; showDashboard(data.admin); await loadWorks();
  } catch (error) { $('#login-error').textContent = error.message; }
});

$('#logout').addEventListener('click', async () => { try { await request('/api/admin/logout', { method: 'POST' }); } finally { showLogin(); } });
$('#new-work').addEventListener('click', () => openEditor());
$('#editor-close').addEventListener('click', closeEditor);
$('#editor-overlay').addEventListener('click', (event) => { if (event.target === $('#editor-overlay')) closeEditor(); });
document.querySelectorAll('[data-save]').forEach((button) => button.addEventListener('click', () => saveWork(button.dataset.save)));
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
  $('#content-editor').focus(); document.execCommand(button.dataset.command, false, button.dataset.value || null);
}));
document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter; document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button)); renderList();
}));

$('#work-list').addEventListener('click', async (event) => {
  const edit = event.target.closest('[data-edit]');
  const status = event.target.closest('[data-status]');
  const remove = event.target.closest('[data-delete]');
  if (edit) openEditor(state.works.find((work) => work.id === Number(edit.dataset.edit)));
  if (status) {
    try { await request(`/api/admin/works/${status.dataset.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: status.dataset.status }) }); await loadWorks(); toast(status.dataset.status === 'published' ? '内容已发布。' : '内容已下架。'); } catch (error) { toast(error.message); }
  }
  if (remove) {
    const work = state.works.find((item) => item.id === Number(remove.dataset.delete));
    if (!confirm(`确定永久删除“${work?.title || '这期内容'}”吗？\n相关音频和封面也会删除，建议先确认服务器已有备份。`)) return;
    try { await request(`/api/admin/works/${remove.dataset.delete}`, { method: 'DELETE' }); await loadWorks(); toast('内容已删除。'); } catch (error) { toast(error.message); }
  }
});

document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#editor-overlay').hidden) closeEditor(); });

(async function init() {
  try {
    const data = await request('/api/admin/session'); state.csrf = data.csrfToken; showDashboard(data.admin); await loadWorks();
  } catch { showLogin(); }
})();
