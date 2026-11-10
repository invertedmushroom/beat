import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDefaultRuleset } from '../src/engine/defaultRules';
import type { EngineSnapshot } from '../src/engine/protocol';
import { parseReplay, ReplayRecorder, serializeReplay } from '../src/replay/archive';

test('client recordings retain aligned ghosts and show a predicted dash before delayed input reaches the host', async ({ page: host, context }, testInfo) => {
  await host.goto('/');
  const roomName = `Ghost ${Date.now()}`;
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await host.getByRole('button', { name: 'Host', exact: true }).click();
  const client = await context.newPage();
  await client.addInitScript(() => {
    const state = { hold: false, queued: [] as Array<() => void>, ghostStrokes: 0 };
    Object.assign(window, { ghostTest: state });
    const create = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = create.apply(this, args);
      if (args[0] === 'beat-input') {
        const send = channel.send.bind(channel);
        channel.send = ((data: string) => { if (state.hold) state.queued.push(() => send(data)); else send(data); }) as typeof channel.send;
      }
      return channel;
    };
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args: Parameters<typeof stroke>) {
      if (this.strokeStyle === '#67e8f9') state.ghostStrokes++;
      stroke.apply(this, args);
    };
  });
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  await client.locator('.room-row').filter({ hasText: roomName }).click();
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await client.bringToFront();
  const start = await host.evaluate(() => window.__BEAT_SNAPSHOT__!.players.find((player) => player.displayName === 'Client')!.x);
  await client.keyboard.down('Digit4');
  await expect.poll(() => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.charging?.chargeTicks ?? 0)).toBeGreaterThan(3);
  await client.evaluate(() => { (window as unknown as { ghostTest: { hold: boolean } }).ghostTest.hold = true; });
  await client.keyboard.up('Digit4');
  await expect.poll(() => client.evaluate(() => window.__BEAT_RENDER_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0)).toBeGreaterThan(start + 1.5);
  expect(await host.evaluate(() => window.__BEAT_SNAPSHOT__!.players.find((player) => player.displayName === 'Client')!.x)).toBeCloseTo(start, 1);
  await client.evaluate(() => {
    const state = (window as unknown as { ghostTest: { hold: boolean; queued: Array<() => void> } }).ghostTest;
    state.hold = false;
    for (const send of state.queued.splice(0)) send();
  });
  await expect.poll(() => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0)).toBeGreaterThan(start + 1.5);
  const tick = await client.evaluate(() => window.__BEAT_SNAPSHOT__!.tick);
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(tick + 35);
  const downloadEvent = client.waitForEvent('download');
  await client.locator('#export-live-replay').click();
  const download = await downloadEvent;
  const clip = parseReplay(Uint8Array.from(await readFile((await download.path())!)).buffer);
  const index = clip.frames.findIndex((frame, i) => frame.diagnostics?.predictedPosition && clip.frames[i + 1]?.diagnostics?.predictedPosition);
  expect(index).toBeGreaterThanOrEqual(0);
  await client.getByRole('button', { name: 'Menu', exact: true }).click();
  await client.locator('#watch-replay').click();
  await client.locator('#replay-timeline').fill(String(Math.ceil((clip.frames[index].tick - clip.frames[0].tick) / clip.metadata.ruleset.tickRate * 1000)));
  await expect(client.locator('#replay-details')).toContainText('Aligned error:');
  await expect(client.getByLabel('Prediction ghost')).toBeEnabled();
  const strokes = () => client.evaluate(() => (window as unknown as { ghostTest: { ghostStrokes: number } }).ghostTest.ghostStrokes);
  await expect.poll(strokes).toBeGreaterThan(0);
  await client.getByLabel('Prediction ghost').uncheck();
  await client.evaluate(() => new Promise(requestAnimationFrame));
  const stopped = await strokes();
  await client.evaluate(() => new Promise(requestAnimationFrame));
  expect(await strokes()).toBe(stopped);
  await client.getByLabel('Prediction ghost').check();
  await expect.poll(strokes).toBeGreaterThan(stopped);
  await client.setViewportSize({ width: 390, height: 844 });
  await client.screenshot({ path: testInfo.outputPath('prediction-ghost.png') });
  await client.getByRole('button', { name: 'Menu', exact: true }).click();
  await client.evaluate(() => new Promise(requestAnimationFrame));
  const left = await strokes();
  await client.evaluate(() => new Promise(requestAnimationFrame));
  expect(await strokes()).toBe(left);
});

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
