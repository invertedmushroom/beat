import { expect, type Page, test } from '@playwright/test';

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
  await page.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await page.mouse.down();
  await page.mouse.move(skill.x + skill.width / 2 - 28, skill.y + skill.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.slotCooldownTicks[2] ?? 0)).toBeGreaterThan(0);
});

test('charged skills telegraph and auto-release on desktop', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);
  const beforeDashX = await page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.x ?? 0);

  const canvas = await page.locator('#arena').boundingBox();
  if (!canvas) {
    throw new Error('arena canvas missing');
  }
  await page.evaluate(() => {
    window.__BEAT_SEEN_CHARGE_FEEDBACK__ = false;
    window.__BEAT_CHARGE_FEEDBACK_WATCH__ = window.setInterval(() => {
      if ((window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0) > 0) {
        window.__BEAT_SEEN_CHARGE_FEEDBACK__ = true;
      }
    }, 16);
  });
  await page.mouse.move(canvas.x + canvas.width - 80, canvas.y + canvas.height / 2);
  await page.bringToFront();
  await page.keyboard.down('4');
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.charging?.ratio ?? 0))
    .toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.slotCooldownTicks[3] ?? 0)).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.charging ?? null)).toBeNull();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SEEN_CHARGE_FEEDBACK__)).toBeTruthy();
  await page.evaluate(() => window.clearInterval(window.__BEAT_CHARGE_FEEDBACK_WATCH__));
  await page.keyboard.up('4');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.x ?? 0)).toBeGreaterThan(beforeDashX + 0.8);
  await expect.poll(async () => page.locator('.skill-slot[data-slot="3"]').evaluate((node) => node.classList.contains('is-ready-flash'))).toBeTruthy();
});

test('mobile charged skill can be aimed by drag hold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const skill = await page.locator('.skill-slot[data-slot="3"]').boundingBox();
  if (!skill) {
    throw new Error('mobile charged skill slot missing');
  }
  await page.evaluate(() => {
    window.__BEAT_SEEN_CHARGE_FEEDBACK__ = false;
    window.__BEAT_CHARGE_FEEDBACK_WATCH__ = window.setInterval(() => {
      if ((window.__BEAT_SNAPSHOT__?.projectiles.length ?? 0) + (window.__BEAT_SNAPSHOT__?.effects.length ?? 0) > 0) {
        window.__BEAT_SEEN_CHARGE_FEEDBACK__ = true;
      }
    }, 16);
  });
  await page.mouse.move(skill.x + skill.width / 2, skill.y + skill.height / 2);
  await page.mouse.down();
  await page.mouse.move(skill.x + skill.width / 2 - 34, skill.y + skill.height / 2, { steps: 4 });
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.charging?.aimDx ?? 0))
    .toBeLessThan(-0.2);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.slotCooldownTicks[3] ?? 0)).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.charging ?? null)).toBeNull();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SEEN_CHARGE_FEEDBACK__)).toBeTruthy();
  await page.evaluate(() => window.clearInterval(window.__BEAT_CHARGE_FEEDBACK_WATCH__));
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.slotCooldownTicks[3] ?? 0)).toBeGreaterThan(0);
});

test('tank movement mode turns body and fires along facing', async ({ page }) => {
  await page.goto('/');
  const patchedRules = await page.locator('#rules-json').evaluate((node) => {
    const rules = JSON.parse((node as HTMLTextAreaElement).value) as {
      obstacles: unknown[];
      player: {
        movement: Record<string, unknown>;
        aim: Record<string, unknown>;
      };
      abilities: Array<Record<string, unknown>>;
    };
    rules.obstacles = [];
    rules.player.movement = {
      mode: 'tank',
      turnSpeedDegrees: 720,
      reverseMultiplier: 0.45,
    };
    rules.player.aim = {
      mode: 'facing',
    };
    const pulse = rules.abilities.find((ability) => ability.id === 'pulse-bolt');
    if (!pulse) {
      throw new Error('pulse-bolt missing');
    }
    Object.assign(pulse, {
      cooldownTicks: 6,
      speed: 1.6,
      lifetimeTicks: 30,
    });
    return `${JSON.stringify(rules, null, 2)}\n`;
  });
  await page.locator('#rules-json').fill(patchedRules);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  await aimCanvas(page, 'left');
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const snapshot = window.__BEAT_SNAPSHOT__;
        const player = snapshot?.players[0];
        const projectile = snapshot?.projectiles[0];
        return player && projectile ? projectile.x - player.x : 0;
      }),
    )
    .toBeGreaterThan(0);

  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.facingDy ?? 0)).toBeGreaterThan(0.35);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.vy ?? 0)).toBeGreaterThan(0.5);
  await page.keyboard.up('ArrowUp');
});

test('authored effects are visible in multiplayer combat', async ({ context, page: host }) => {
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill('Effects Lab');
  const patchedRules = await host.locator('#rules-json').evaluate((node) => {
    const rules = JSON.parse((node as HTMLTextAreaElement).value) as {
      obstacles: unknown[];
      abilities: Array<Record<string, unknown>>;
    };
    rules.obstacles = [];
    const pulse = rules.abilities.find((ability) => ability.id === 'pulse-bolt');
    if (!pulse) {
      throw new Error('pulse-bolt missing');
    }
    Object.assign(pulse, {
      damage: 24,
      cooldownTicks: 6,
      radius: 0.45,
      range: 46,
      speed: 2.4,
      lifetimeTicks: 40,
      effects: [
        { kind: 'knockback', force: 2.8 },
        { kind: 'slow', multiplier: 0.35, durationTicks: 60 },
      ],
    });
    const spark = rules.abilities.find((ability) => ability.id === 'seeker-spark');
    if (!spark) {
      throw new Error('seeker-spark missing');
    }
    Object.assign(spark, {
      cooldownTicks: 6,
      effects: [{ kind: 'heal', target: 'self', amount: 30 }],
    });
    return `${JSON.stringify(rules, null, 2)}\n`;
  });
  await host.locator('#rules-json').fill(patchedRules);
  await host.getByRole('button', { name: 'Apply' }).click();
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: 'Effects Lab' });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  const clientBeforeHitX = await host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0);
  await host.bringToFront();
  await aimCanvas(host, 'right');
  await host.keyboard.press('Space');
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.status?.slowTicks ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0))
    .toBeGreaterThan(clientBeforeHitX + 0.5);

  const hostHpBeforeHit = await host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.hp ?? 0);
  await client.bringToFront();
  await aimCanvas(client, 'left');
  await client.keyboard.press('Space');
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.hp ?? 0))
    .toBeLessThan(hostHpBeforeHit);

  const hostHpAfterHit = await host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.hp ?? 0);
  await host.bringToFront();
  await host.locator('.skill-slot[data-slot="2"]').click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.slotCooldownTicks[2] ?? 0)).toBeGreaterThan(0);
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.hp ?? 0))
    .toBeGreaterThan(hostHpAfterHit);
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.combatTexts.some((text) => text.kind === 'heal') ?? false)).toBeTruthy();
});

async function aimCanvas(page: Page, side: 'left' | 'right'): Promise<void> {
  const canvas = await page.locator('#arena').boundingBox();
  if (!canvas) {
    throw new Error('arena canvas missing');
  }
  const x = side === 'right' ? canvas.x + canvas.width - 24 : canvas.x + 24;
  await page.mouse.move(x, canvas.y + canvas.height / 2);
}
