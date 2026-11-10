// DesignUp private preview: the service worker. After sign-in it serves every page, script, style, content file and
// image of the sealed site and docs at their normal addresses, decrypting them in memory. It holds no keys or content.
importScripts('_gate/core.js');

const scope = new URL(self.registration.scope);
const BASE = scope.pathname;
const PUBLIC = /^(sw\.js|404\.html|robots\.txt|\.nojekyll|_gate\/.*|sealed\/.*)$/;
const RECHECK_MS = 60000;
let current = null; // { publish, scopes, files, keys, checked }
let loading = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data === 'signout' || event.data === 'refresh') { current = null; loading = null; }
});

async function endSession(notice) {
  current = null;
  await DUP.store.del('session');
  if (notice) await DUP.store.put('notice', notice);
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('offline');
  const bytes = await res.arrayBuffer();
  return { json: JSON.parse(new TextDecoder().decode(bytes)), size: bytes.byteLength };
}

async function load() {
  const session = await DUP.store.get('session');
  if (!session) { current = null; return null; }
  if (session.until < Date.now()) return endSession(session.persistent ? 'period-over' : 'period-over-short');
  if (current && Date.now() - current.checked < RECHECK_MS) return current;
  let pointer;
  try { pointer = await fetchJson(new URL('sealed/publish.json', scope)); } catch { return current; }
  if (!pointer) return current;
  const publish = pointer.json.publish;
  if (current && current.publish === publish && current.name === session.name) { current.checked = Date.now(); return current; }
  const ring = await fetchJson(new URL(`sealed/${publish}/access/${encodeURIComponent(session.name)}.json`, scope));
  if (!ring) return endSession('ended');
  let inner;
  try {
    DUP.checkKeyring(ring.json, ring.size);
    inner = await DUP.openKeyring(ring.json, session.name, publish, session.codeKey);
  } catch { return endSession('ended'); }
  if (Date.parse(inner.ends) < Date.now()) return endSession('ended');
  const files = {};
  for (const [name, raw] of Object.entries(inner.scopes)) {
    const res = await fetch(new URL(`sealed/${publish}/${name}.bin`, scope));
    if (!res.ok) throw new Error('missing manifest');
    const key = await DUP.importAes(DUP.fromB64(raw));
    const manifest = JSON.parse(new TextDecoder().decode(await DUP.openBinary(key, await res.arrayBuffer(), DUP.aad.manifest(publish, name))));
    Object.assign(files, manifest.files);
  }
  current = { name: session.name, publish, scopes: Object.keys(inner.scopes), files, keys: new Map(), checked: Date.now() };
  return current;
}

function state() {
  loading ??= load().finally(() => { loading = null; });
  return loading;
}

function lookup(files, relative) {
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  if (files[relative]) return files[relative];
  if (!/\.[a-z0-9]+$/i.test(relative) && files[`${relative}/index.html`]) return files[`${relative}/index.html`];
  return null;
}

const headers = (type) => ({
  'Content-Type': type,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
});

async function serve(request, relative) {
  const navigate = request.mode === 'navigate';
  let s;
  try { s = await state(); } catch { s = null; }
  if (!s) return navigate ? fetch(request) : new Response('Locked', { status: 401, headers: headers('text/plain') });
  const entry = lookup(s.files, relative);
  if (!entry) {
    if (navigate && relative.startsWith('docs') && !s.scopes.includes('docs')) return Response.redirect(scope.href, 302);
    return new Response('Not found', { status: 404, headers: headers('text/plain; charset=utf-8') });
  }
  const res = await fetch(new URL(`sealed/m/${entry.n}`, scope));
  if (!res.ok) return new Response('Not found', { status: 404, headers: headers('text/plain; charset=utf-8') });
  let key = s.keys.get(entry.n);
  if (!key) { key = await DUP.importAes(DUP.fromB64(entry.k)); s.keys.set(entry.n, key); }
  let body = await DUP.openBinary(key, await res.arrayBuffer(), DUP.aad.file(entry.n));
  if (entry.t.startsWith('text/html')) {
    const html = new TextDecoder().decode(body);
    const tag = `<script src="${BASE}_gate/session.js" defer></script>`;
    body = new TextEncoder().encode(html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : tag + html);
  }
  return new Response(body, { status: 200, headers: headers(entry.t) });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(BASE) || event.request.method !== 'GET') return;
  const relative = decodeURIComponent(url.pathname.slice(BASE.length));
  if (PUBLIC.test(relative)) return;
  event.respondWith(serve(event.request, relative));
});
