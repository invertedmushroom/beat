/// <reference lib="webworker" />
export {};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Vite injects every built asset, including worker and lazy prediction bundles.
const inventory = self.__WB_MANIFEST;
const scope = self.registration.scope;
const prefix = `beat-shell:${scope}:`;
const urls = new Set(inventory.map((entry) => new URL(entry.url, scope).href));
const indexUrl = new URL('index.html', scope).href;
const cacheName = crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(inventory)))
  .then((digest) => prefix + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));

async function installShell(): Promise<void> {
  const name = await cacheName;
  const cache = await caches.open(name);
  // A worker-only hotfix may have an unchanged asset inventory. Reuse the
  // completed cache rather than risking deletion of the active release on failure.
  if (await cache.match(indexUrl)) return;
  try {
    await cache.addAll(Array.from(urls, (url) => new Request(url, { cache: 'reload' })));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

async function activateShell(): Promise<void> {
  const name = await cacheName;
  const owned = (await caches.keys()).filter((key) => key.startsWith(prefix) && key !== name);
  // Keep the preceding release for a page opened during the activation boundary.
  await Promise.all(owned.slice(0, -1).map((key) => caches.delete(key)));
  await self.clients.claim();
}

async function cachedAsset(url: string): Promise<Response> {
  const name = await cacheName;
  const current = await caches.open(name);
  const hit = await current.match(url);
  if (hit) return hit;
  const previous = (await caches.keys()).filter((key) => key.startsWith(prefix) && key !== name);
  for (const key of previous) {
    const cached = await (await caches.open(key)).match(url);
    if (cached) return cached;
  }
  // No runtime response writes. Errors remain errors, never an HTML fallback.
  return fetch(url);
}

function shellRequest(request: Request): string | undefined {
  if (request.method !== 'GET') return undefined;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return undefined;
  if (request.mode === 'navigate') {
    if (url.pathname === new URL(scope).pathname || url.pathname === new URL(indexUrl).pathname) return indexUrl;
    return undefined;
  }
  if (request.cache === 'no-store') return undefined;
  if (urls.has(url.href)) return url.href;
  if (url.href.startsWith(new URL('assets/', scope).href)) return url.href;
  return undefined;
}

async function applyUpdate(event: ExtendableMessageEvent): Promise<void> {
  const port = event.ports[0];
  const source = event.source;
  if (!port || !source || !('id' in source)) return;
  const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => client.url.startsWith(scope));
  if (windows.length !== 1 || windows[0].id !== source.id) {
    port.postMessage({ kind: 'blocked', reason: 'Close other Beat tabs or windows, then try updating again.' });
    return;
  }
  port.postMessage({ kind: 'ready' });
  await self.skipWaiting();
}

self.addEventListener('install', (event) => event.waitUntil(installShell()));
self.addEventListener('activate', (event) => event.waitUntil(activateShell()));
self.addEventListener('fetch', (event) => {
  const url = shellRequest(event.request);
  if (url) event.respondWith(cachedAsset(url));
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'BEAT_APPLY_UPDATE') event.waitUntil(applyUpdate(event));
  if (event.data?.type === 'BEAT_SHELL_STATUS') {
    event.waitUntil(cacheName.then(async (name) => {
      const ready = await (await caches.open(name)).match(indexUrl);
      event.ports[0]?.postMessage({ kind: ready ? 'ready' : 'error' });
    }));
  }
});
