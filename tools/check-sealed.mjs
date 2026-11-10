// The public side's structural check: every file Pages will serve is either a public gate file or ciphertext with a
// valid header. Runs in the public repository's workflow and locally before every commit and push. Plain Node, no
// dependencies, no secrets. Usage: node check-sealed.mjs <site folder>
import fs from 'node:fs';
import path from 'node:path';

const siteDir = path.resolve(process.argv[2] || 'site');
const MAX_FILE = 50 * 1024 * 1024;
const findings = [];
const add = (category, file) => findings.push({ category, file });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const header = (buf) => buf.subarray(0, 4).toString('latin1');
const gateFile = /^(index\.html|404\.html|sw\.js|robots\.txt|\.nojekyll|_gate\/(core\.js|session\.js|mark\.svg|assets\/[\w.-]+\.(js|css|woff2|woff|svg)))$/;
const keyringKeys = ['v', 'kdf', 'iter', 'salt', 'iv', 'ct'];
let publish = null;

if (!fs.existsSync(siteDir)) {
  console.error(`No site folder at ${siteDir}`);
  process.exit(1);
}
const pointerFile = path.join(siteDir, 'sealed', 'publish.json');
if (fs.existsSync(pointerFile)) {
  const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  if (Object.keys(pointer).sort().join() !== 'publish,v' || !/^[\w-]{8,32}$/.test(pointer.publish)) add('publish pointer', 'sealed/publish.json');
  publish = pointer.publish;
} else add('missing publish pointer', 'sealed/publish.json');

let sealedCount = 0;
let keyrings = 0;
let total = 0;
for (const full of walk(siteDir)) {
  const rel = path.relative(siteDir, full).split(path.sep).join('/');
  const size = fs.statSync(full).size;
  total += size;
  if (size > MAX_FILE) add('file too large', rel);
  if (rel.endsWith('.map')) add('source map', rel);
  if (gateFile.test(rel)) continue;
  if (rel === 'sealed/publish.json') continue;
  const buf = fs.readFileSync(full);
  const isSealedFile = /^sealed\/m\/[\w-]{16}$/.test(rel) || (publish && new RegExp(`^sealed/${publish}/(site|docs)\\.bin$`).test(rel));
  if (isSealedFile) {
    if (header(buf) !== 'DUP1' || (size - 32) % 4096 !== 0 || size < 4096 + 32) add('bad sealed file', rel);
    sealedCount += 1;
    continue;
  }
  if (publish && new RegExp(`^sealed/${publish}/access/[a-z-]{2,20}\\.json$`).test(rel)) {
    let ok = size < 65536;
    try {
      const json = JSON.parse(buf.toString('utf8'));
      ok &&= Object.keys(json).join() === keyringKeys.join() && json.v === 1 && json.kdf === 'PBKDF2-SHA256' && json.iter === 600000;
    } catch { ok = false; }
    if (!ok) add('bad keyring', rel);
    keyrings += 1;
    continue;
  }
  add('unexpected file', rel);
}

const report = { site: path.basename(siteDir), files: sealedCount, keyrings, totalMB: +(total / 1048576).toFixed(1), findings: findings.length };
console.log(JSON.stringify(report));
for (const f of findings) console.error(`FINDING ${f.category}: ${f.file}`);
if (findings.length || !keyrings) process.exit(1);
