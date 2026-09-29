import sanitizeHtml from 'sanitize-html';

const SESSION_COOKIE = 'ffc_session';
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_AUDIO_BYTES = 80 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

const mimeExtensions = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['audio/mpeg', '.mp3'], ['audio/mp4', '.m4a'], ['audio/x-m4a', '.m4a'], ['audio/m4a', '.m4a'],
  ['audio/aac', '.aac'], ['audio/flac', '.flac'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'],
  ['audio/ogg', '.ogg'], ['audio/webm', '.webm']
]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function securityHeaders(headers = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders })
  });
}

function parseCookies(header = '') {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function safeEqual(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(left))),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(right)))
  ]);
  const av = new Uint8Array(a); const bv = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < av.length; index += 1) difference |= av[index] ^ bv[index];
  return difference === 0;
}

async function createSession(env) {
  const payload = stringToBase64Url(JSON.stringify({
    username: env.ADMIN_USERNAME || 'admin',
    csrf: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24))),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  }));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function readSession(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !await safeEqual(signature, await hmac(env.SESSION_SECRET, payload))) return null;
  try {
    const data = JSON.parse(base64UrlToString(payload));
    return data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch { return null; }
}

function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function publicWork(row) {
  const mediaUrl = (key) => `/media/${String(key).split('/').map(encodeURIComponent).join('/')}`;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    issueNumber: row.issue_number,
    host: row.host_name,
    guest: row.guest_name,
    excerpt: row.excerpt,
    contentHtml: row.content_html,
    coverUrl: row.cover_key ? mediaUrl(row.cover_key) : null,
    audioUrl: row.audio_key ? mediaUrl(row.audio_key) : null,
    audioOriginalName: row.audio_original_name || null,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const cleanHtml = (value = '') => sanitizeHtml(String(value), {
  allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'a', 'hr'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) }
});

function slugify(value, fallback) {
  const slug = String(value || '').trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || fallback;
}

function formText(form, name) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function readPayload(form) {
  const status = ['draft', 'published', 'archived'].includes(formText(form, 'status')) ? formText(form, 'status') : 'draft';
  const title = formText(form, 'title').trim();
  if (!title) throw new HttpError(400, '请填写标题。');
  const rawDate = formText(form, 'publishedAt');
  const publishedAt = rawDate ? new Date(rawDate).toISOString() : (status === 'published' ? new Date().toISOString() : null);
  return {
    title: title.slice(0, 200),
    slug: slugify(formText(form, 'slug'), `episode-${Date.now()}`),
    issueNumber: formText(form, 'issueNumber').trim().slice(0, 40),
    host: formText(form, 'host').trim().slice(0, 100),
    guest: formText(form, 'guest').trim().slice(0, 100),
    excerpt: formText(form, 'excerpt').trim().slice(0, 1000),
    contentHtml: cleanHtml(formText(form, 'contentHtml')),
    status, publishedAt
  };
}

function fileFrom(form, name) {
  const value = form.get(name);
  return value && typeof value === 'object' && typeof value.stream === 'function' && value.size > 0 ? value : null;
}

function validateFile(file, kind) {
  if (!file) return;
  const extension = mimeExtensions.get(file.type);
  const correctKind = kind === 'cover' ? file.type.startsWith('image/') : file.type.startsWith('audio/');
  if (!extension || !correctKind) throw new HttpError(400, `${kind === 'cover' ? '封面' : '音频'}格式不支持。`);
  const limit = kind === 'cover' ? MAX_COVER_BYTES : MAX_AUDIO_BYTES;
  if (file.size > limit) throw new HttpError(413, `${kind === 'cover' ? '封面' : '音频'}文件过大。`);
}

async function uploadFile(env, file, kind) {
  if (!file) return null;
  validateFile(file, kind);
  const extension = mimeExtensions.get(file.type);
  const key = `${kind === 'cover' ? 'covers' : 'audio'}/${crypto.randomUUID()}${extension}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=604800' },
    customMetadata: { originalName: String(file.name || '').slice(0, 200) }
  });
  return key;
}

async function requireAdmin(request, env, csrf = false) {
  const session = await readSession(request, env);
  if (!session) throw new HttpError(401, '登录已过期，请重新登录。');
  if (csrf && !await safeEqual(request.headers.get('x-csrf-token') || '', session.csrf || '')) {
    throw new HttpError(403, '安全校验失败，请刷新后台后重试。');
  }
  return session;
}

function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, '请求来源不受信任。');
}

async function handleLogin(request, env) {
  checkOrigin(request);
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, '后台尚未完成初始化，请先在 Cloudflare 中设置密码。');
  }
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const cutoff = Date.now() - 15 * 60 * 1000;
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run();
  const attempts = await env.DB.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE ip = ? AND attempted_at >= ?').bind(ip, cutoff).first();
  if ((attempts?.count || 0) >= 10) throw new HttpError(429, '登录尝试过于频繁，请稍后再试。');
  const body = await request.json();
  const valid = await safeEqual(body.username || '', env.ADMIN_USERNAME || 'admin') && await safeEqual(body.password || '', env.ADMIN_PASSWORD);
  if (!valid) {
    await env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, Date.now()).run();
    throw new HttpError(401, '用户名或密码不正确。');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  const token = await createSession(env);
  const session = await readSession(new Request(request.url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), env);
  return json({ admin: { username: env.ADMIN_USERNAME || 'admin' }, csrfToken: session.csrf }, 200, { 'Set-Cookie': sessionCookie(token, request) });
}

async function handlePublic(request, env, url) {
  if (url.pathname === '/api/health') return json({ ok: true, service: 'inside-ffc-cloudflare', time: new Date().toISOString() });
  if (url.pathname === '/api/works' && request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    const now = new Date().toISOString();
    const [rows, count] = await Promise.all([
      env.DB.prepare(`SELECT * FROM works WHERE status = 'published' AND (published_at IS NULL OR published_at <= ?) ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ? OFFSET ?`).bind(now, limit, offset).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM works WHERE status = 'published' AND (published_at IS NULL OR published_at <= ?)`).bind(now).first()
    ]);
    return json({ works: rows.results.map(publicWork), total: count?.count || 0 });
  }
  const detail = url.pathname.match(/^\/api\/works\/([^/]+)$/);
  if (detail && request.method === 'GET') {
    const row = await env.DB.prepare(`SELECT * FROM works WHERE slug = ? COLLATE NOCASE AND status = 'published' AND (published_at IS NULL OR published_at <= ?)`).bind(decodeURIComponent(detail[1]), new Date().toISOString()).first();
    if (!row) throw new HttpError(404, '没有找到这期内容。');
    return json({ work: publicWork(row) });
  }
  return null;
}

async function handleAdmin(request, env, ctx, url) {
  if (url.pathname === '/api/admin/login' && request.method === 'POST') return handleLogin(request, env);
  const session = await requireAdmin(request, env, !['GET', 'HEAD'].includes(request.method));
  if (!['GET', 'HEAD'].includes(request.method)) checkOrigin(request);

  if (url.pathname === '/api/admin/session' && request.method === 'GET') {
    return json({ admin: { username: session.username }, csrfToken: session.csrf });
  }
  if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
  }
  if (url.pathname === '/api/admin/works' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM works ORDER BY updated_at DESC, id DESC').all();
    return json({ works: rows.results.map(publicWork) });
  }
  if (url.pathname === '/api/admin/works' && request.method === 'POST') {
    const form = await request.formData();
    const data = readPayload(form); const cover = fileFrom(form, 'cover'); const audio = fileFrom(form, 'audio');
    validateFile(cover, 'cover'); validateFile(audio, 'audio');
    const uploaded = [];
    try {
      const coverKey = await uploadFile(env, cover, 'cover'); if (coverKey) uploaded.push(coverKey);
      const audioKey = await uploadFile(env, audio, 'audio'); if (audioKey) uploaded.push(audioKey);
      const result = await env.DB.prepare(`INSERT INTO works (title, slug, issue_number, host_name, guest_name, excerpt, content_html, cover_key, audio_key, audio_original_name, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        data.title, data.slug, data.issueNumber, data.host, data.guest, data.excerpt, data.contentHtml,
        coverKey, audioKey, audio?.name || null, data.status, data.publishedAt
      ).run();
      const row = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(result.meta.last_row_id).first();
      return json({ work: publicWork(row) }, 201);
    } catch (error) {
      if (uploaded.length) ctx.waitUntil(Promise.all(uploaded.map((key) => env.MEDIA.delete(key))));
      throw error;
    }
  }

  const item = url.pathname.match(/^\/api\/admin\/works\/(\d+)$/);
  const statusRoute = url.pathname.match(/^\/api\/admin\/works\/(\d+)\/status$/);
  if (item && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(item[1]).first();
    if (!row) throw new HttpError(404, '内容不存在。');
    return json({ work: publicWork(row) });
  }
  if (item && request.method === 'PUT') {
    const existing = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(item[1]).first();
    if (!existing) throw new HttpError(404, '内容不存在。');
    const form = await request.formData(); const data = readPayload(form);
    const cover = fileFrom(form, 'cover'); const audio = fileFrom(form, 'audio');
    validateFile(cover, 'cover'); validateFile(audio, 'audio');
    const uploaded = [];
    try {
      const newCover = await uploadFile(env, cover, 'cover'); if (newCover) uploaded.push(newCover);
      const newAudio = await uploadFile(env, audio, 'audio'); if (newAudio) uploaded.push(newAudio);
      await env.DB.prepare(`UPDATE works SET title = ?, slug = ?, issue_number = ?, host_name = ?, guest_name = ?, excerpt = ?, content_html = ?, cover_key = ?, audio_key = ?, audio_original_name = ?, status = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(
        data.title, data.slug, data.issueNumber, data.host, data.guest, data.excerpt, data.contentHtml,
        newCover || existing.cover_key, newAudio || existing.audio_key, audio?.name || existing.audio_original_name,
        data.status, data.publishedAt, item[1]
      ).run();
      const oldKeys = [newCover && existing.cover_key, newAudio && existing.audio_key].filter(Boolean);
      if (oldKeys.length) ctx.waitUntil(Promise.all(oldKeys.map((key) => env.MEDIA.delete(key))));
      const row = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(item[1]).first();
      return json({ work: publicWork(row) });
    } catch (error) {
      if (uploaded.length) ctx.waitUntil(Promise.all(uploaded.map((key) => env.MEDIA.delete(key))));
      throw error;
    }
  }
  if (statusRoute && request.method === 'PATCH') {
    const body = await request.json();
    if (!['draft', 'published', 'archived'].includes(body.status)) throw new HttpError(400, '状态不正确。');
    const result = await env.DB.prepare(`UPDATE works SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(body.status, body.status, new Date().toISOString(), statusRoute[1]).run();
    if (!result.meta.changes) throw new HttpError(404, '内容不存在。');
    const row = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(statusRoute[1]).first();
    return json({ work: publicWork(row) });
  }
  if (item && request.method === 'DELETE') {
    const existing = await env.DB.prepare('SELECT * FROM works WHERE id = ?').bind(item[1]).first();
    if (!existing) throw new HttpError(404, '内容不存在。');
    await env.DB.prepare('DELETE FROM works WHERE id = ?').bind(item[1]).run();
    const keys = [existing.cover_key, existing.audio_key].filter(Boolean);
    if (keys.length) ctx.waitUntil(Promise.all(keys.map((key) => env.MEDIA.delete(key))));
    return json({ ok: true });
  }
  throw new HttpError(404, '接口不存在。');
}

async function handleMedia(request, env, url) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '不支持这个请求。');
  const key = decodeURIComponent(url.pathname.slice('/media/'.length));
  if (!key) throw new HttpError(404, '文件不存在。');
  const object = request.method === 'HEAD'
    ? await env.MEDIA.head(key)
    : await env.MEDIA.get(key, { onlyIf: request.headers, range: request.headers });
  if (!object) throw new HttpError(404, '文件不存在。');
  const headers = new Headers(securityHeaders({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800' }));
  object.writeHttpMetadata(headers); headers.set('ETag', object.httpEtag);
  let status = 'body' in object ? 200 : 412;
  if (request.headers.has('range') && object.range && 'body' in object) {
    status = 206;
    headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    headers.set('Content-Length', String(object.range.length));
  } else headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' || !('body' in object) ? null : object.body, { status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        const assetUrl = new URL('/admin/index.html', url);
        return env.ASSETS.fetch(new Request(assetUrl, { method: 'GET', headers: request.headers }));
      }
      if (url.pathname.startsWith('/works/')) {
        const assetUrl = new URL('/index.html', url);
        return env.ASSETS.fetch(new Request(assetUrl, { method: 'GET', headers: request.headers }));
      }
      if (url.pathname.startsWith('/media/')) return await handleMedia(request, env, url);
      if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(request, env, ctx, url);
      if (url.pathname.startsWith('/api/')) {
        const response = await handlePublic(request, env, url);
        if (response) return response;
        throw new HttpError(404, '接口不存在。');
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      const duplicateSlug = String(error?.message || '').includes('UNIQUE constraint failed: works.slug');
      const status = duplicateSlug ? 409 : (error.status || 500);
      if (status >= 500) console.error(error);
      const message = duplicateSlug ? '链接别名已被使用，请换一个。' : (status >= 500 ? '请求处理失败，请稍后重试。' : error.message);
      return json({ error: message }, status);
    }
  }
};
