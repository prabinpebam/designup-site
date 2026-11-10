import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@design-library/core/css/index.css';
import '../src/look';
import '../src/templates/designup/tokens/tokens.css';
import '../../deploy/core.js';
import {
  Alert, Button, Checkbox, Heading, Notifications, PageLayout, SiteLayout, Skeleton, Stack, Text, TextField, notify,
} from '@design-library/core/components';
import { GateMark } from './GateMark';
import w from './words.json';

// The gate's crypto and storage come from the shared core (deploy/core.js), which sets self.DUP.
type Store = { get: (k: string) => Promise<unknown>; put: (k: string, v: unknown) => Promise<unknown>; del: (k: string) => Promise<unknown> };
type Core = {
  parseCode: (s: string) => string[];
  fromB64: (s: string) => Uint8Array;
  checkKeyring: (json: unknown, size?: number) => unknown;
  deriveCodeKey: (secret: string[], salt: Uint8Array) => Promise<CryptoKey>;
  openKeyring: (json: unknown, name: string, publish: string, key: CryptoKey) => Promise<{ ends: string }>;
  store: Store;
};
const DUP = (self as unknown as { DUP: Core }).DUP;
const BASE = import.meta.env.BASE_URL;
const DAY = 86400000;
const MIN_PENDING_MS = 200;

type Page = 'entry' | 'remembered' | 'unsupported';
type Notice = { title: string; text: string; retry?: boolean } | null;
class Wrong extends Error {}
class Offline extends Error {}

const supported = 'serviceWorker' in navigator && Boolean(window.crypto?.subtle) && 'indexedDB' in window;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function codeInput() {
  return document.querySelector<HTMLInputElement>('input[name="code"]');
}

async function worker() {
  const registration = await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
  await navigator.serviceWorker.ready;
  return registration;
}

async function getJson(url: string) {
  let res: Response;
  try { res = await fetch(url, { cache: 'no-cache' }); } catch { throw new Offline(); }
  if (res.status === 404) throw new Wrong();
  if (!res.ok) throw new Offline();
  const text = await res.text();
  return { json: JSON.parse(text), size: text.length };
}

function Gate() {
  const [page, setPage] = useState<Page>(supported ? 'entry' : 'unsupported');
  const [code, setCode] = useState('');
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!supported) return;
    worker().catch(() => setPage('unsupported'));
    (async () => {
      const kind = await DUP.store.get('notice');
      if (kind) await DUP.store.del('notice');
      if (kind === 'signed-out') notify({ message: w.signedOut, tone: 'success', dismiss: 'auto' });
      if (kind === 'ended') setNotice({ title: w.endedTitle, text: w.ended });
      if (kind === 'period-over') setNotice({ title: w.periodTitle, text: w.periodOver });
      if (kind === 'period-over-short') setNotice({ title: w.periodTitle, text: w.periodOverShort });
      const session = await DUP.store.get('session');
      if (!session) return;
      // A remembered device: the service worker opens the site once it controls this page.
      const tried = sessionStorage.getItem('designup-preview-reload');
      if (tried && navigator.serviceWorker.controller) {
        sessionStorage.removeItem('designup-preview-reload');
        setNotice({ title: w.offlineTitle, text: w.offline, retry: true });
        return;
      }
      setPage('remembered');
      await worker();
      sessionStorage.setItem('designup-preview-reload', '1');
      location.reload();
    })().catch(() => setPage('entry'));
  }, []);

  async function signIn(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const words = DUP.parseCode(code);
    setNotice(null);
    if (words.length < 5) {
      setError(w.malformed);
      codeInput()?.select();
      return;
    }
    setError(undefined);
    setBusy(true);
    setStep(w.checking);
    const started = performance.now();
    const settle = () => wait(Math.max(0, MIN_PENDING_MS - (performance.now() - started)));
    try {
      const registration = await worker();
      const pointer = await getJson(`${BASE}sealed/publish.json`).catch((e) => { throw e instanceof Wrong ? new Offline() : e; });
      const publish = String(pointer.json.publish);
      const ring = await getJson(`${BASE}sealed/${publish}/access/${encodeURIComponent(words[0])}.json`);
      let inner: { ends: string };
      let codeKey: CryptoKey;
      try {
        DUP.checkKeyring(ring.json, ring.size);
        codeKey = await DUP.deriveCodeKey(words.slice(1), DUP.fromB64(ring.json.salt));
        inner = await DUP.openKeyring(ring.json, words[0], publish, codeKey);
      } catch { throw new Wrong(); }
      if (Date.parse(inner.ends) < Date.now()) {
        await settle();
        setError(w.expired.replace('{date}', longDate(inner.ends)));
        setBusy(false);
        setStep('');
        codeInput()?.select();
        return;
      }
      const until = Math.min(Date.parse(inner.ends), Date.now() + (keep ? 30 * DAY : DAY / 2));
      await DUP.store.put('session', { name: words[0], codeKey, persistent: keep, until });
      setStep(w.opening);
      registration.active?.postMessage('refresh');
      navigator.serviceWorker.controller?.postMessage('refresh');
      await settle();
      sessionStorage.setItem('designup-preview-reload', '1');
      location.reload();
    } catch (e) {
      await settle();
      setBusy(false);
      setStep('');
      if (e instanceof Offline) setNotice({ title: w.offlineTitle, text: w.offline, retry: true });
      else { setError(w.wrong); codeInput()?.select(); }
    }
  }

  const header = (
    <Stack gap="item">
      <GateMark alt={w.brandAlt} />
      <Heading level={1}>{w.heading}</Heading>
      <Text variant="lead">{w.line}</Text>
    </Stack>
  );

  return (
    <>
    <SiteLayout header={null} width="reading">
      <PageLayout header={header}>
        {page === 'unsupported' && <Alert tone="warning" placement="page" title={w.unsupportedTitle}>{w.unsupported}</Alert>}
        {page === 'remembered' && (
          <div aria-busy="true" aria-label={w.opening}>
            <Stack gap="item"><Skeleton /><Skeleton /></Stack>
          </div>
        )}
        {page === 'entry' && (
          <Stack gap="group">
            {notice && (
              <Alert tone={notice.retry ? 'error' : 'info'} placement="page" title={notice.title} announce="polite"
                actions={notice.retry ? <Button label={w.tryAgain} onClick={() => (code ? signIn() : location.reload())} /> : undefined}>
                {notice.text}
              </Alert>
            )}
            <form onSubmit={signIn} noValidate>
              <Stack gap="item">
                <TextField mode="form" type="password" name="code" label={w.fieldLabel} hint={w.fieldHint} value={code}
                  onChange={(next) => { setCode(next); if (error) setError(undefined); }} readOnly={busy} error={error} />
                <Checkbox label={w.keep} checked={keep} onChange={setKeep} />
                <Button type="submit" emphasis="primary" label={w.signIn} busy={busy} pendingLabel={w.signingIn} />
                <div role="status">{step && <Text variant="body-sm" tone="muted">{step}</Text>}</div>
              </Stack>
            </form>
            <Text variant="body-sm" tone="muted">{w.help}</Text>
          </Stack>
        )}
      </PageLayout>
    </SiteLayout>
    <Notifications />
    </>
  );
}

document.title = w.title;
createRoot(document.getElementById('root')!).render(<StrictMode><Gate /></StrictMode>);
