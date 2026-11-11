import { test as base, expect, type Page } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';

let builds: string;
base.beforeAll(async () => {
  builds = await mkdtemp(join(tmpdir(), 'beat-pwa-'));
  for (const release of ['a', 'b']) {
    await build({
      logLevel: 'error',
      define: {
        'import.meta.env.VITE_DIRECTORY_DRIVER': JSON.stringify('local'),
        'import.meta.env.VITE_STDB_DATABASE': 'undefined',
        'import.meta.env.VITE_STDB_MODULE': 'undefined',
        'import.meta.env.VITE_DIRECTORY_URL': 'undefined',
        'import.meta.env.VITE_ICE_SERVERS_URL': 'undefined',
      },
      build: { outDir: join(builds, release), emptyOutDir: true, sourcemap: false },
      plugins: [{
        name: 'test-release-marker',
        transform(code, id) {
          if (id.replaceAll('\\', '/').endsWith('/src/main.ts')) return `${code}\ndocument.documentElement.dataset.testRelease = '${release}';`;
        },
      }],
    });
  }
}, 120_000);

base.afterAll(async () => {
  if (builds && dirname(builds) === tmpdir() && basename(builds).startsWith('beat-pwa-')) await rm(builds, { recursive: true, force: true });
});

type Delivery = { url: string; release: string; failAssets: boolean; workerRevision: number };
const test = base.extend<{ delivery: Delivery }>({
  delivery: async ({ baseURL: _baseURL }, use) => {
    const delivery = { url: '', release: 'a', failAssets: false, workerRevision: 0 };
    const server = createServer((request, response) => {
      void serve(delivery, request.url ?? '/', response);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    delivery.url = `http://127.0.0.1:${address.port}/beat/`;
    try { await use(delivery); }
    finally { await new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }); }
  },
});

async function serve(delivery: Delivery, path: string, response: ServerResponse): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  const relative = new URL(path, delivery.url).pathname.replace(/^\/beat\//, '') || 'index.html';
  if (relative === 'api/failure') { response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"unavailable"}'); return; }
  if (relative === 'ice') { response.writeHead(200, { 'Content-Type': 'application/json' }).end('[{"urls":"turn:test","credential":"ephemeral"}]'); return; }
  if (delivery.failAssets && relative.startsWith('assets/worker-')) { response.writeHead(503).end(); return; }
  const root = resolve(builds, delivery.release);
  const file = resolve(root, relative);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const mime = types[extname(relative)] ?? 'text/html';
  try {
    const body = await readFile(file);
    const served = relative === 'sw.js' ? Buffer.concat([body, Buffer.from(`\n// worker revision ${delivery.workerRevision}`)]) : body;
    response.writeHead(200, { 'Content-Type': mime }).end(served);
  }
  catch { response.writeHead(404).end('missing'); }
}

async function ready(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#pwa-status')).toContainText('Offline practice, workbench and replay files are ready', { timeout: 20_000 });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

async function update(page: Page): Promise<void> {
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
}

test('precaches unopened simulation/prediction bundles and runs practice offline under a path prefix', async ({ page, context, delivery }) => {
  await ready(page, delivery.url);
  const assets = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((key) => key.startsWith('beat-shell:'));
    return (await (await caches.open(names[0])).keys()).map((request) => request.url);
  });
  expect(assets.some((url) => /\/worker-[^/]+\.js$/.test(url))).toBe(true);
  expect(assets.some((url) => /\/collisionPrediction-[^/]+\.js$/.test(url))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#device-context')).toContainText('Offline');
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Watch last replay' }).click();
  await expect(page.locator('#arena-view')).toHaveClass(/is-replay/);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await expect(page.locator('#workbench-view')).toBeVisible();
});

test('leaves API and missing-asset errors intact and never caches ICE credentials', async ({ page, context, delivery }) => {
  await ready(page, delivery.url);
  const result = await page.evaluate(async () => {
    const api = await fetch('./api/failure');
    const missing = await fetch('./assets/missing.js');
    await fetch('./ice', { cache: 'no-store' });
    const requests = await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)));
    return { api: api.status, body: await api.json(), missing: missing.status, cache: requests.flat() };
  });
  expect(result).toMatchObject({ api: 503, body: { error: 'unavailable' }, missing: 404 });
  expect(result.cache.some((url) => url.endsWith('/ice'))).toBe(false);
  await context.setOffline(true);
  expect(await page.evaluate(async () => { try { await fetch('./ice', { cache: 'no-store' }); return 'unexpected'; } catch { return 'network failure'; } })).toBe('network failure');
});

test('defers a real A→B update through live play, cancel and a second tab, then advances the app', async ({ page, context, delivery }) => {
  await ready(page, delivery.url);
  await page.evaluate(async () => { await (await caches.open('another-app')).put('/keep', new Response('keep')); });
  await page.getByRole('button', { name: 'Host', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
  const client = await context.newPage();
  await ready(client, delivery.url);
  await client.locator('.room-row').first().click();
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBeGreaterThan(1);
  delivery.release = 'b';
  await update(page);
  // The hidden menu action is also guarded at the controller, independently of UI.
  await page.locator('#pwa-update').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#pwa-status')).toContainText('Return to the menu');
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'a');
  const tick = await client.evaluate(() => window.__BEAT_SNAPSHOT__!.tick);
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(tick + 5);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await page.locator('#pwa-status').evaluate((node) => { node.textContent = ''; });
  await page.locator('#pwa-update').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator('#pwa-status')).toContainText('Return to the menu');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('#display-name').fill('Unsaved name');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#pwa-update').click();
  await expect(page.locator('#display-name')).toHaveValue('Unsaved name');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#pwa-update').click();
  await expect(page.locator('#pwa-status')).toContainText('Close other Beat tabs');
  await expect(page.locator('#display-name')).toHaveValue('Unsaved name');
  await client.close();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#pwa-update').click();
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'b');
  await expect(page.locator('#pwa-update')).toBeHidden();
  expect(await page.evaluate(() => caches.has('another-app'))).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'b');
});

test('failed update precaching preserves the running release and reports failure', async ({ page, delivery }) => {
  await ready(page, delivery.url);
  delivery.release = 'b';
  delivery.failAssets = true;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect(page.locator('#pwa-status')).toContainText('download failed');
  await expect(page.locator('html')).toHaveAttribute('data-test-release', 'a');
  await expect(page.locator('#pwa-update')).toBeHidden();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
});

test('worker-only updates reuse the completed cache without exposing it to failed downloads', async ({ page, context, delivery }) => {
  await ready(page, delivery.url);
  delivery.workerRevision++;
  delivery.failAssets = true;
  await update(page);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
});

test('exposes phone install and wake controls with optional browser capabilities', async ({ page, delivery }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => {
      const sentinel = Object.assign(new EventTarget(), { released: false, release: async () => { sentinel.released = true; sentinel.dispatchEvent(new Event('release')); } });
      return sentinel;
    } } });
  });
  await ready(page, delivery.url);
  await page.locator('#pwa-install').click();
  await expect(page.locator('#pwa-status')).toContainText('browser');
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => ({ outcome: 'accepted' }) });
    window.dispatchEvent(event);
  });
  await expect(page.locator('#pwa-install')).toHaveText('Install app');
  await page.locator('#pwa-install').click();
  await expect(page.locator('#pwa-install')).toHaveText('Install via browser');
  await page.getByRole('button', { name: 'Keep screen awake', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Allow screen sleep', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const manifest = await (await page.request.get(delivery.url + 'manifest.webmanifest')).json();
  expect(manifest.icons.filter((icon: { type: string }) => icon.type === 'image/png')).toHaveLength(3);
  for (const icon of manifest.icons) expect((await page.request.get(delivery.url + icon.src)).ok()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('phone-device.png'), fullPage: true });
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
  await expect(page.getByRole('button', { name: 'Allow screen sleep', exact: true })).toBeVisible();
  const picker = await page.getByLabel('Control profile').boundingBox();
  expect(picker!.x).toBeGreaterThanOrEqual(0);
  expect(picker!.x + picker!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('phone-arena-device.png') });
});
