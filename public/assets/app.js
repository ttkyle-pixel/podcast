const state = { works: [], current: null, speedIndex: 0, speeds: [1, 1.25, 1.5, 2, .75] };
const $ = (selector) => document.querySelector(selector);
const audio = $('#audio');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function dateLabel(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

async function api(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '内容读取失败。');
  return data;
}

function cardTemplate(work) {
  const cover = work.coverUrl ? `<img class="cover-image" src="${escapeHtml(work.coverUrl)}" alt="" loading="lazy">` : '';
  return `<article class="episode-card">
    <div class="cover">${cover}<b>ISSUE ${escapeHtml(work.issueNumber || '—')}</b><strong>FFC</strong></div>
    <div class="card-body">
      <div class="meta">${escapeHtml(dateLabel(work.publishedAt))}${work.host ? ` · 主播 ${escapeHtml(work.host)}` : ''}</div>
      <h3>${escapeHtml(work.title)}</h3><p>${escapeHtml(work.excerpt || '点击进入收听 Podcast 并阅读文字版。')}</p>
      <div class="card-actions">
        <button class="listen" type="button" data-listen="${work.id}">▶ 收听</button>
        <a class="read" href="/works/${encodeURIComponent(work.slug)}" data-read="${work.id}">阅读文字版</a>
      </div>
    </div></article>`;
}

function renderHome() {
  const grid = $('#episode-grid');
  $('#episode-count').textContent = state.works.length ? `共 ${state.works.length} 期内容` : '内容持续更新中';
  if (!state.works.length) {
    grid.innerHTML = '<div class="empty">暂时还没有已发布内容。</div>';
    return;
  }
  const latest = state.works[0];
  $('#hero-title').textContent = latest.title;
  $('#hero-summary').textContent = latest.excerpt || '点击进入收听 Podcast 并阅读文字版。';
  $('#hero-issue').textContent = latest.issueNumber || 'NEW';
  grid.innerHTML = state.works.map(cardTemplate).join('');
}

async function openWork(workOrSlug, autoplay = false, push = true) {
  try {
    let work = typeof workOrSlug === 'object' ? workOrSlug : state.works.find((item) => item.id === Number(workOrSlug));
    if (!work && typeof workOrSlug === 'string') work = (await api(`/api/works/${encodeURIComponent(workOrSlug)}`)).work;
    if (!work) throw new Error('没有找到这期内容。');
    state.current = work;
    $('#article-issue').textContent = `${work.issueNumber || 'INSIDE FFC'} · READ`;
    $('#article-title').textContent = work.title;
    const people = [work.host && `主播：${work.host}`, work.guest && `嘉宾：${work.guest}`].filter(Boolean).join(' · ');
    $('#article-meta').textContent = [dateLabel(work.publishedAt), people].filter(Boolean).join(' · ');
    $('#article-content').innerHTML = work.contentHtml || '<p>暂无文字版内容。</p>';
    audio.pause();
    audio.src = work.audioUrl || '';
    audio.load();
    $('#article-player').hidden = !work.audioUrl;
    $('#article-overlay').hidden = false;
    document.body.classList.add('no-scroll');
    if (push) history.pushState({ slug: work.slug }, '', `/works/${encodeURIComponent(work.slug)}`);
    if (autoplay && work.audioUrl) await audio.play().catch(() => toast('请点击播放按钮开始收听。'));
  } catch (error) { toast(error.message); }
}

function closeArticle(push = true) {
  $('#article-overlay').hidden = true;
  document.body.classList.remove('no-scroll');
  if (push && location.pathname.startsWith('/works/')) history.pushState({}, '', '/');
}

function toggleAudio() {
  if (!audio.src) return toast('本期暂未上传音频。');
  if (audio.paused) audio.play().catch(() => toast('音频暂时无法播放。'));
  else audio.pause();
}

document.addEventListener('click', (event) => {
  const listen = event.target.closest('[data-listen]');
  const read = event.target.closest('[data-read]');
  if (listen) openWork(listen.dataset.listen, true);
  if (read) { event.preventDefault(); openWork(read.dataset.read); }
});

$('#hero-listen').addEventListener('click', () => state.works[0] && openWork(state.works[0], true));
$('#hero-read').addEventListener('click', () => state.works[0] && openWork(state.works[0]));
$('#article-close').addEventListener('click', () => closeArticle());
$('#article-overlay').addEventListener('click', (event) => { if (event.target === $('#article-overlay')) closeArticle(); });
$('#play-button').addEventListener('click', toggleAudio);
$('#sticky-play').addEventListener('click', toggleAudio);
$('#sticky-open').addEventListener('click', () => { if (state.current) openWork(state.current, false, false); });
$('#speed-button').addEventListener('click', () => {
  state.speedIndex = (state.speedIndex + 1) % state.speeds.length;
  audio.playbackRate = state.speeds[state.speedIndex];
  $('#speed-button').textContent = `${audio.playbackRate}×`;
});
$('#seek').addEventListener('input', (event) => { if (audio.duration) audio.currentTime = audio.duration * Number(event.target.value) / 100; });
audio.addEventListener('play', () => { $('#play-button').textContent = '❚❚'; $('#sticky-play').textContent = '❚❚'; $('#sticky-player').hidden = false; $('#sticky-title').textContent = state.current?.title || '正在播放'; });
audio.addEventListener('pause', () => { $('#play-button').textContent = '▶'; $('#sticky-play').textContent = '▶'; });
audio.addEventListener('timeupdate', () => {
  $('#current-time').textContent = timeLabel(audio.currentTime);
  $('#duration').textContent = timeLabel(audio.duration);
  $('#seek').value = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
  $('#sticky-time').textContent = `${timeLabel(audio.currentTime)} / ${timeLabel(audio.duration)}`;
});
audio.addEventListener('ended', () => { $('#sticky-player').hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('#article-overlay').hidden) closeArticle(); });
window.addEventListener('popstate', () => {
  const slug = decodeURIComponent(location.pathname.match(/^\/works\/([^/]+)/)?.[1] || '');
  if (slug) openWork(slug, false, false); else closeArticle(false);
});

(async function init() {
  try {
    state.works = (await api('/api/works?limit=100')).works;
    renderHome();
    const slug = decodeURIComponent(location.pathname.match(/^\/works\/([^/]+)/)?.[1] || '');
    if (slug) await openWork(slug, false, false);
  } catch (error) {
    $('#episode-grid').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
})();
