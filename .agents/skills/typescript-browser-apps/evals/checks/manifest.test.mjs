import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.env.EVAL_WORKSPACE;

test('production manifest preserves installed-window presentation', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dist/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
});

test('built manifest launches the requested app within the deployment base', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'dist/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Field Notes');
  assert.equal(manifest.short_name, 'Notes');
  const manifestUrl = 'https://example.test/field/manifest.webmanifest';
  const startUrl = new URL(manifest.start_url, manifestUrl);
  assert.equal(startUrl.href, 'https://example.test/field/?mode=camera');
  // The manifest specification resolves id against start_url's origin.
  let identity = startUrl;
  if (typeof manifest.id === 'string' && manifest.id !== '') {
    try {
      const candidate = new URL(manifest.id, `${startUrl.origin}/`);
      if (candidate.origin === startUrl.origin) identity = candidate;
    } catch {}
  }
  identity.hash = '';
  assert.equal(identity.href, 'https://example.test/field/', 'keep the previously installed app identity');
  assert.equal(new URL(manifest.scope, manifestUrl).href, 'https://example.test/field/');
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  const link = html.match(/<link\b(?=[^>]*\brel=["']manifest["'])[^>]*\bhref=["']([^"']+)["']/i);
  assert.ok(link, 'built HTML must link the manifest');
  assert.equal(new URL(link[1], 'https://example.test/field/').href, manifestUrl);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl);
    assert.equal(url.origin, 'https://example.test');
    assert.ok(url.pathname.startsWith('/field/'));
    assert.ok((await readFile(join(root, 'dist', url.pathname.slice('/field/'.length)))).length > 0);
  }
});

test('production artifact preserves the online-only delivery contract', async () => {
  const files = await readdir(join(root, 'dist'), { recursive: true, withFileTypes: true });
  for (const file of files.filter(entry => entry.isFile())) {
    const path = join(file.parentPath, file.name);
    if (!/\.(?:html|[cm]?js|json|webmanifest|svg|css)$/.test(path)) continue;
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /serviceWorker\s*\.\s*register\s*\(|\bimportScripts\s*\(|\bcaches\s*\.\s*(?:open|match)\s*\(/);
    assert.ok(!/(?:^|[/\\])(?:sw|service-worker|workbox[^/\\]*)\.[cm]?js$/i.test(path), path);
  }
});
