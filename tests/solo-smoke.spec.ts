import { expect, test } from '@playwright/test';

test('solo mode initializes Rapier and advances snapshots without console noise', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleMessages.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleMessages.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        tick: window.__BEAT_SNAPSHOT__?.tick ?? 0,
        players: window.__BEAT_SNAPSHOT__?.players.length ?? 0,
      })),
    )
    .toMatchObject({ players: 1 });
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0))
    .toBeGreaterThan(2);
  const canvas = await page.locator('#arena').boundingBox();
  if (!canvas) {
    throw new Error('arena canvas missing');
  }
  await page.mouse.move(canvas.x + 20, canvas.y + canvas.height / 2);
  await page.keyboard.press('Space');
  await expect
    .poll(async () => page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0)))
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const snapshot = window.__BEAT_SNAPSHOT__;
        const player = snapshot?.players[0];
        const projectile = snapshot?.projectiles[0];
        return player && projectile ? projectile.x - player.x : 1;
      }),
    )
    .toBeLessThan(0);

  const beforeSlotCast = await page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0));
  await page.keyboard.press('Digit2');
  await expect
    .poll(async () => page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0)))
    .toBeGreaterThan(beforeSlotCast);

  const beforeButtonCast = await page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0));
  await page.locator('.skill-slot[data-slot="3"]').click();
  await expect
    .poll(async () => page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0)))
    .toBeGreaterThan(beforeButtonCast);

  expect(consoleMessages.filter((line) => /rawintegrationparameters_new|deprecated parameters|Cannot read/.test(line))).toEqual([]);
});

test('mobile viewport can move and fire with touch controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const joystick = await page.locator('#touch-joystick').boundingBox();
  if (!joystick) {
    throw new Error('touch joystick missing');
  }
  await page.mouse.move(joystick.x + joystick.width / 2, joystick.y + joystick.height / 2);
  await page.mouse.down();
  await page.mouse.move(joystick.x + joystick.width / 2 + 42, joystick.y + joystick.height / 2, { steps: 4 });
  await expect.poll(async () => page.evaluate(() => Math.abs(window.__BEAT_SNAPSHOT__?.players[0]?.vx ?? 0))).toBeGreaterThan(0.5);
  await page.mouse.up();

  const fire = await page.locator('#touch-fire').boundingBox();
  if (!fire) {
    throw new Error('touch fire pad missing');
  }
  await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await page.mouse.down();
  await page.mouse.move(fire.x + fire.width / 2 + 36, fire.y + fire.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0)))
    .toBeGreaterThan(0);

  const skill = await page.locator('.skill-slot[data-slot="2"]').boundingBox();
  if (!skill) {
    throw new Error('mobile skill slot missing');
  }
  const beforeSkillCast = await page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0));
  await page.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await page.mouse.down();
  await page.mouse.move(skill.x + skill.width / 2 - 28, skill.y + skill.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => page.evaluate(() => (window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0)))
    .toBeGreaterThan(beforeSkillCast);
});
