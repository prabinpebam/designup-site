// DesignUp private preview: added to every decrypted page by the service worker. It adds the quiet Sign out link to
// the page's footer, and locks every open tab when any of them signs out. It holds no keys or content.
(function () {
  const script = document.currentScript;
  const base = new URL('..', script.src).pathname;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('designup-preview') : null;
  const toGate = () => location.replace(base);

  function deleteSession() {
    return new Promise((resolve) => {
      const open = indexedDB.open('designup-preview', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve();
      open.onsuccess = () => {
        const t = open.result.transaction('kv', 'readwrite');
        t.objectStore('kv').delete('session');
        t.objectStore('kv').put('signed-out', 'notice');
        t.oncomplete = t.onerror = () => { open.result.close(); resolve(); };
      };
    });
  }

  async function signOut(event) {
    event.preventDefault();
    await deleteSession();
    navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('signout');
    channel && channel.postMessage('signout');
    toGate();
  }

  function hasSession() {
    return new Promise((resolve) => {
      const open = indexedDB.open('designup-preview', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const get = open.result.transaction('kv').objectStore('kv').get('session');
        get.onsuccess = () => { open.result.close(); resolve(Boolean(get.result)); };
        get.onerror = () => { open.result.close(); resolve(false); };
      };
    });
  }

  function link() {
    const a = document.createElement('a');
    a.href = base;
    a.textContent = 'Sign out';
    a.setAttribute('data-preview-signout', '');
    a.style.color = 'inherit';
    a.style.font = 'inherit';
    a.addEventListener('click', signOut);
    return a;
  }

  // The site's footer gets the link; the docs, which have no footer, get it at the end of their navigation.
  function place() {
    if (document.querySelector('[data-preview-signout]')) return true;
    const footer = document.querySelector('footer');
    const nav = document.querySelector('nav');
    const host = footer || (nav && nav.closest('aside')) || nav;
    if (!host) return false;
    const holder = document.createElement('p');
    holder.appendChild(link());
    host.appendChild(holder);
    return true;
  }

  // Keeps watching, because the site re-renders its footer when the route changes.
  function watch() {
    place();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      // A timer, not an animation frame: frames don't run in a hidden tab, and the link must be there when it shows.
      setTimeout(() => { queued = false; place(); }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  channel && channel.addEventListener('message', (e) => { if (e.data === 'signout') toGate(); });
  window.addEventListener('pageshow', async (e) => { if (e.persisted && !(await hasSession())) toGate(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
