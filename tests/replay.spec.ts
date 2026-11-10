import { expect, test } from '@playwright/test';
import { createDefaultRuleset } from '../src/engine/defaultRules';
import type { EngineSnapshot } from '../src/engine/protocol';
import { ReplayRecorder, serializeReplay } from '../src/replay/archive';

for (const tickRate of [60, 120]) {
  test(`replay buttons step between recorded samples at ${tickRate} Hz`, async ({ page }) => {
    const ruleset = createDefaultRuleset();
    ruleset.tickRate = tickRate;
    const recorder = new ReplayRecorder({ version: 1, source: 'solo', ruleset, recordedAt: 123 });
    for (let tick = 1; tick <= 17; tick++) {
      const snapshot: EngineSnapshot = { tick, nowMs: tick * 1000 / tickRate, rulesetId: ruleset.id,
        match: { elapsedTicks: tick, remainingTicks: 100, durationTicks: 100, scoreLimit: 1, finished: false, teams: [] },
        players: [], objectives: [], projectiles: [], physicsBodies: [], constraints: [], effects: [], combatTexts: [], mechanicTraces: [], aiTraces: [] };
      recorder.record(snapshot);
    }
    const clip = recorder.clip()!;
    await page.goto('/');
    await page.locator('#replay-file').setInputFiles({ name: 'high-rate.beat', mimeType: 'application/octet-stream', buffer: Buffer.from(serializeReplay(clip)) });
    await expect(page.getByRole('region', { name: 'Replay controls' })).toBeVisible();
    for (const tick of clip.frames.slice(1).map((frame) => frame.tick)) {
      await page.getByRole('button', { name: 'Next replay frame', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick)).toBe(tick);
    }
    for (const tick of clip.frames.slice(0, -1).reverse().map((frame) => frame.tick)) {
      await page.getByRole('button', { name: 'Previous replay frame', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick)).toBe(tick);
    }
  });
}

test('records, exports, imports, and seeks a replay without starting a live simulation', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const counts = { workers: 0, peers: 0 };
    Object.assign(window, { replayResourceCounts: counts });
    window.Worker = new Proxy(window.Worker, { construct(target, args) { counts.workers++; return Reflect.construct(target, args); } });
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, { construct(target, args) { counts.peers++; return Reflect.construct(target, args); } });
  });
  await page.goto('/');
  await expect(page.locator('#watch-replay')).toBeDisabled();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(20);
  await page.keyboard.up('KeyD');
  await expect(page.locator('#export-live-replay')).toBeEnabled();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#watch-replay')).toBeEnabled();
  await page.locator('#watch-replay').click();
  await expect(page.getByRole('region', { name: 'Replay controls' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(0);
  const firstTick = await page.evaluate(() => window.__BEAT_SNAPSHOT__!.tick);
  await page.getByRole('button', { name: 'Next replay frame', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick)).toBe(firstTick + 1);
  await page.getByRole('button', { name: 'Previous replay frame', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick)).toBe(firstTick);
  await page.locator('#replay-speed').selectOption('2');
  await page.locator('#replay-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(firstTick + 2);
  await page.locator('#replay-timeline').fill('0');
  await expect(page.locator('#replay-toggle')).toHaveText('Play replay');
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick)).toBe(firstTick);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-live-replay').click();
  const download = await downloadEvent;
  const archivePath = testInfo.outputPath('session.beat');
  await download.saveAs(archivePath);
  expect(download.suggestedFilename()).toMatch(/\.beat$/);

  await page.reload();
  await expect(page.locator('#watch-replay')).toBeDisabled();
  await page.locator('#replay-file').setInputFiles(archivePath);
  await expect(page.getByRole('region', { name: 'Replay controls' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await page.locator('#replay-controls').boundingBox();
  expect(controls).toBeTruthy();
  expect(controls!.x).toBeGreaterThanOrEqual(0);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#touch-controls')).toBeHidden();
  await page.keyboard.down('KeyD');
  await page.keyboard.press('Space');
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => (window as unknown as { replayResourceCounts: unknown }).replayResourceCounts)).toEqual({ workers: 0, peers: 0 });
  await page.screenshot({ path: testInfo.outputPath('replay-mobile.png') });

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('#replay-file').setInputFiles({ name: 'broken.beat', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
  await expect(page.locator('#replay-summary')).toContainText('Replay import failed');
  await expect(page.locator('#watch-replay')).toBeEnabled();
  await page.locator('#watch-replay').click();
  await expect(page.getByRole('region', { name: 'Replay controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve) => {
        Object.assign(window, { releaseReplayImport: () => void read.call(this).then(resolve) });
      });
    };
  });
  await page.locator('#replay-file').setInputFiles(archivePath);
  await expect(page.locator('#replay-summary')).toContainText('Loading replay');
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseReplayImport: () => void }).releaseReplayImport());
  await expect(page.getByRole('region', { name: 'Replay controls' })).toBeHidden();
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.vx ?? 0)).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyD');
  expect(errors).toEqual([]);
});
