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

function seasonLabel(value) {
  const season = Number(value) || 2;
  if (season === 1) return '第一季';
  if (season === 2) return '第二季';
  return `第 ${season} 季`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '内容读取失败。');
  return data;
}

function articleMeta(work) {
  const people = [work.host && `主播：${work.host}`, work.guest && `嘉宾：${work.guest}`].filter(Boolean).join(' · ');
  return [dateLabel(work.publishedAt), people, `${Number(work.viewCount) || 0} 次浏览`].filter(Boolean).join(' · ');
}

function updateViewCount(work, viewCount) {
  work.viewCount = Number(viewCount) || 0;
  const listedWork = state.works.find((item) => item.id === work.id);
  if (listedWork) listedWork.viewCount = work.viewCount;
  document.querySelectorAll(`[data-view-count-id="${work.id}"]`).forEach((element) => {
    element.textContent = `${work.viewCount} 次浏览`;
  });
  if (state.current?.id === work.id) $('#article-meta').textContent = articleMeta(work);
}

async function recordView(work) {
  try {
    const data = await api(`/api/works/${encodeURIComponent(work.slug)}/view`, { method: 'POST' });
    updateViewCount(work, data.viewCount);
  } catch { /* 浏览数统计失败不影响文章正常打开。 */ }
}

function cardTemplate(work) {
  const cover = work.coverUrl ? `<img class="cover-image" src="${escapeHtml(work.coverUrl)}" alt="" loading="lazy">` : '';
  return `<article class="episode-card">
    <div class="cover">${cover}<b>SEASON ${Number(work.seasonNumber) || 2} · ISSUE ${escapeHtml(work.issueNumber || '—')}</b><strong>FFC</strong></div>
    <div class="card-body">
      <div class="meta">${escapeHtml(dateLabel(work.publishedAt))}${work.host ? ` · 主播 ${escapeHtml(work.host)}` : ''} · <span data-view-count-id="${work.id}">${Number(work.viewCount) || 0} 次浏览</span></div>
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
  $('#hero-issue').textContent = `Season${Number(latest.seasonNumber) || 2} ${latest.issueNumber || 'NEW'}`;
  const seasons = [...new Set(state.works.map((work) => Number(work.seasonNumber) || 2))].sort((a, b) => b - a);
  grid.innerHTML = seasons.map((season) => {
    const works = state.works.filter((work) => (Number(work.seasonNumber) || 2) === season);
    return `<section class="season-block" aria-labelledby="season-${season}-title">
      <div class="season-head"><div><small>SEASON ${season}</small><h3 id="season-${season}-title">${seasonLabel(season)}</h3></div><span>${works.length} 期</span></div>
      <div class="episode-grid">${works.map(cardTemplate).join('')}</div>
    </section>`;
  }).join('');
}

async function openWork(workOrSlug, autoplay = false, push = true) {
  try {
    let work = typeof workOrSlug === 'object' ? workOrSlug : state.works.find((item) => item.id === Number(workOrSlug));
    if (!work && typeof workOrSlug === 'string') work = (await api(`/api/works/${encodeURIComponent(workOrSlug)}`)).work;
    if (!work) throw new Error('没有找到这期内容。');
    state.current = work;
    $('#article-issue').textContent = `${seasonLabel(work.seasonNumber)} · ${work.issueNumber || 'FFC'} · READ`;
    $('#article-title').textContent = work.title;
    $('#article-meta').textContent = articleMeta(work);
    $('#article-content').innerHTML = work.contentHtml || '<p>暂无文字版内容。</p>';
    audio.pause();
    audio.src = work.audioUrl || '';
    audio.load();
    $('#article-player').hidden = !work.audioUrl;
    $('#article-overlay').hidden = false;
    document.body.classList.add('no-scroll');
    if (push) history.pushState({ slug: work.slug }, '', `/works/${encodeURIComponent(work.slug)}`);
    recordView(work);
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
