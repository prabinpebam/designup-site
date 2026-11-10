// DesignUp private preview: the crypto core shared by the sealer and code tool (Node), the gate page and the service
// worker. A classic script with no imports, so it loads with importScripts, a bundler or a Node import. It holds no keys.
(function (root) {
  const subtle = root.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITER = 600000;
  const MAGIC = 'DUP1';
  const KEYRING_MAX = 65536;

  const toB64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64 = (s) => {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  const rand = (n) => root.crypto.getRandomValues(new Uint8Array(n));

  // Five or more words; case doesn't matter; spaces, hyphens, underscores, dots and commas separate words.
  const parseCode = (input) => String(input || '').toLowerCase().split(/[\s\-_.,]+/).filter(Boolean);

  // Plain text is padded so sizes show only rough magnitudes.
  function padUnit(length) {
    if (length < 65536) return 4096;
    if (length < 1048576) return 16384;
    return 262144;
  }
  function pad(data) {
    const unit = padUnit(data.length + 4);
    const out = new Uint8Array(Math.ceil((data.length + 4) / unit) * unit);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(data, 4);
    return out;
  }

  const aad = {
    file: (name) => `designup/media/v1|${name}`,
    manifest: (publish, scope) => `designup/manifest/v1|${publish}|${scope}`,
    keyring: (name, publish, header) => `designup/keyring/v1|${name}|${publish}|${JSON.stringify(header)}`,
  };

  const importAes = (raw, usages = ['decrypt']) => subtle.importKey('raw', raw, 'AES-GCM', false, usages);

  async function deriveCodeKey(secretWords, salt, extractable = false) {
    const base = await subtle.importKey('raw', enc.encode(secretWords.join(' ')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base,
      { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
  }

  async function sealBinary(key, plain, additional) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(additional) }, key, pad(plain)));
    const out = new Uint8Array(16 + ct.length);
    out.set(enc.encode(MAGIC), 0);
    out.set(iv, 4);
    out.set(ct, 16);
    return out;
  }

  async function openBinary(key, bytes, additional) {
    const u8 = new Uint8Array(bytes);
    if (u8.length < 32 || dec.decode(u8.subarray(0, 4)) !== MAGIC) throw new Error('bad header');
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(4, 16), additionalData: enc.encode(additional) }, key, u8.subarray(16)));
    const length = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    if (length > plain.length - 4) throw new Error('bad length');
    return plain.subarray(4, 4 + length);
  }

  async function makeKeyring(codeKey, name, publish, salt, inner) {
    const header = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: toB64(salt), iv: toB64(rand(12)) };
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: fromB64(header.iv), additionalData: enc.encode(aad.keyring(name, publish, header)) },
      codeKey, enc.encode(JSON.stringify(inner))));
    return { ...header, ct: toB64(ct) };
  }

  // Refuses any keyring whose clear settings differ from the only ones this site uses.
  function checkKeyring(json, byteLength) {
    if (byteLength !== undefined && byteLength > KEYRING_MAX) throw new Error('refused settings');
    if (!json || json.v !== 1 || json.kdf !== 'PBKDF2-SHA256' || json.iter !== ITER) throw new Error('refused settings');
    if (fromB64(json.salt).length !== 16 || fromB64(json.iv).length !== 12 || typeof json.ct !== 'string') throw new Error('refused settings');
    return { v: json.v, kdf: json.kdf, iter: json.iter, salt: json.salt, iv: json.iv };
  }

  async function openKeyring(json, name, publish, codeKey) {
    const header = checkKeyring(json);
    const inner = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(json.iv), additionalData: enc.encode(aad.keyring(name, publish, header)) },
      codeKey, fromB64(json.ct));
    return JSON.parse(dec.decode(inner));
  }

  // Browser storage: the session (a non-extractable code key, never the code) and one notice for the gate.
  const db = () => new Promise((resolve, reject) => {
    const r = root.indexedDB.open('designup-preview', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => { d.close(); resolve(req && req.result); };
      t.onerror = () => { d.close(); reject(t.error); };
    });
  };
  const store = {
    get: (k) => tx('readonly', (s) => s.get(k)),
    put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    del: (k) => tx('readwrite', (s) => s.delete(k)),
  };

  root.DUP = {
    ITER, KEYRING_MAX, toB64, fromB64, rand, parseCode, pad, aad, importAes, deriveCodeKey,
    sealBinary, openBinary, makeKeyring, checkKeyring, openKeyring, store,
  };
})(typeof self !== 'undefined' ? self : globalThis);
