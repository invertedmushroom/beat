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

  await pressGameKey(page, 'Digit2');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.slotCooldownTicks[1] ?? 0)).toBeGreaterThan(0);

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

test('keyboard movement resets on browser focus loss', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  await page.keyboard.down('KeyD');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.vx ?? 0)).toBeGreaterThan(0.5);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => page.evaluate(() => Math.abs(window.__BEAT_SNAPSHOT__?.players[0]?.vx ?? 0))).toBeLessThan(0.2);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);
  await expect.poll(async () => page.evaluate(() => Math.abs(window.__BEAT_SNAPSHOT__?.players[0]?.vx ?? 0))).toBeLessThan(0.2);
  await page.keyboard.up('KeyD');
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
  await openAdvancedJson(page);
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
  await applyAndCloseWorkbench(page);
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  await aimCanvas(page, 'left');
  await pressGameKey(page, 'Space');
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

test('rules inspector validates mechanics examples and updates hash', async ({ page }) => {
  await page.goto('/');
  await openWorkbench(page);
  await expect(page.locator('#rules-validation-line')).toContainText('valid');
  await expect(page.locator('#rules-inspector')).toContainText('Center Relic');
  await expect(page.locator('#rules-inspector')).toContainText('Shock Bonus');
  const beforeHash = await page.locator('#rules-hash-line').textContent();

  await page.getByRole('tab', { name: 'Presets' }).click();
  await page.getByRole('button', { name: 'Bleed DOT' }).click();
  await expect(page.locator('#rules-validation-line')).toContainText('valid');
  await expect(page.locator('#rules-inspector')).toContainText('Bleeding');
  await expect
    .poll(async () => page.locator('#rules-hash-line').textContent())
    .not.toBe(beforeHash);

  await applyAndCloseWorkbench(page);
  await page.getByRole('button', { name: 'Solo' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.resources.length ?? 0)).toBeGreaterThan(0);
});

test('workbench edits platform controls and local preferences persist', async ({ page }) => {
  await page.goto('/');
  await openWorkbench(page);
  await page.getByRole('tab', { name: 'Player' }).click();
  await page.locator('#workbench-movement-mode').selectOption('platform');
  await page.locator('#workbench-platform-gravity').fill('34');
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await page.locator('#pref-hud-scale').fill('1.2');
  await page.locator('#pref-skill-position').selectOption('right');
  await page.locator('#pref-trace-open').check();
  await applyAndCloseWorkbench(page);

  await page.reload();
  await openWorkbench(page);
  await page.getByRole('tab', { name: 'Preferences' }).click();
  await expect(page.locator('#pref-hud-scale')).toHaveValue('1.2');
  await expect(page.locator('#pref-skill-position')).toHaveValue('right');
  await expect(page.locator('#pref-trace-open')).toBeChecked();
  await page.getByRole('tab', { name: 'Player' }).click();
  await page.locator('#workbench-movement-mode').selectOption('platform');
  await applyAndCloseWorkbench(page);

  await page.getByRole('button', { name: 'Solo' }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const player = window.__BEAT_SNAPSHOT__?.players[0];
        return Boolean(player && player.y > 3 && Math.abs(player.vy) < 0.25);
      }),
    )
    .toBeTruthy();
  await page.keyboard.down('KeyW');
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players[0]?.vy ?? 0)).toBeLessThan(-2);
  await page.keyboard.up('KeyW');
});

test('workbench keyboard tabs edit structured fields and starts play', async ({ page }) => {
  await page.goto('/');
  await openWorkbench(page);

  await page.getByRole('tab', { name: 'Player' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Abilities' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Match' }).click();
  await page.locator('#workbench-rule-name').fill('Workbench Smoke');
  await page.getByRole('tab', { name: 'Abilities' }).click();
  await page.locator('#workbench-ability-select').selectOption('pulse-bolt');
  await page.locator('#workbench-ability-damage').fill('13');
  await page.getByRole('tab', { name: 'NPCs' }).click();
  await page.locator('#workbench-npc-select').selectOption('spark-chaser');
  await page.locator('#workbench-npc-speed').fill('0.9');

  await applyAndCloseWorkbench(page);
  await page.getByRole('button', { name: 'Lab' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect(page.locator('#status-line')).toContainText('lab');
});

test('advanced JSON wrapper and invalid edits preserve last accepted rules', async ({ page }) => {
  await page.goto('/');
  await openAdvancedJson(page);
  const baseJson = await page.locator('#rules-json').inputValue();
  const baseRules = JSON.parse(baseJson) as Record<string, unknown>;
  await page.locator('#rules-json').fill(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        rules: {
          ...baseRules,
          name: 'Wrapped Workbench',
        },
        editor: {
          selectedTab: 'npcs',
        },
      },
      null,
      2,
    )}\n`,
  );
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('tab', { name: 'NPCs' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#rules-inspector')).toContainText('Wrapped Workbench');

  await page.getByRole('tab', { name: 'Advanced JSON' }).click();
  await page.locator('#rules-json').fill('{"id":');
  await expect(page.locator('#rules-validation-line')).toContainText('invalid');
  await expect(page.locator('#workbench-diagnostics')).toContainText('$');

  await page.getByRole('tab', { name: 'Match' }).click();
  await expect(page.locator('#workbench-rule-name')).toHaveValue('Wrapped Workbench');
});

test('relic push objective scores and ends a match', async ({ page }) => {
  await page.goto('/');
  await openAdvancedJson(page);
  const patchedRules = await page.locator('#rules-json').evaluate((node) => {
    const rules = JSON.parse((node as HTMLTextAreaElement).value) as {
      obstacles: unknown[];
      match: {
        durationTicks: number;
        scoreLimit: number;
      };
      objectives: Array<{
        id: string;
        scoreCooldownTicks: number;
        scoreZones: Array<Record<string, unknown>>;
      }>;
    };
    rules.obstacles = [];
    rules.match.durationTicks = 300;
    rules.match.scoreLimit = 1;
    const relic = rules.objectives.find((objective) => objective.id === 'center-relic');
    if (!relic) {
      throw new Error('center relic missing');
    }
    relic.scoreCooldownTicks = 1;
    relic.scoreZones = [{ id: 'instant-goal', team: 'players', x: 0, y: 0, radius: 3, points: 1, color: '#2fd17c' }];
    return `${JSON.stringify(rules, null, 2)}\n`;
  });
  await page.locator('#rules-json').fill(patchedRules);
  await applyAndCloseWorkbench(page);
  await page.getByRole('button', { name: 'Solo' }).click();

  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.match.teams.find((team) => team.id === 'players')?.score ?? 0))
    .toBe(1);
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.match.finished ?? false)).toBeTruthy();
  await expect(page.locator('#match-line')).toContainText('Players wins');
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_TRACE__?.some((trace) => trace.event === 'onScore' && trace.objectiveId === 'center-relic') ?? false))
    .toBeTruthy();
});

test('lab spawns rules-authored actors and explains mechanics in trace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lab' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.role === 'npc')?.displayName ?? ''))
    .toBe('Training Dummy');
  await expect(page.locator('#local-mechanics')).toContainText('Shield');
  await expect(page.locator('#lab-controls')).toBeVisible();

  await page.keyboard.press('Space');
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.role === 'npc')?.statuses.some((status) => status.id === 'shocked') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const dummy = window.__BEAT_SNAPSHOT__?.players.find((player) => player.role === 'npc');
        return dummy ? dummy.hp < dummy.maxHp : false;
      }),
    )
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_TRACE__?.some((trace) => trace.kind === 'trigger' && trace.triggerId === 'shock-bonus') ?? false))
    .toBeTruthy();

  await page.locator('.arena-log summary').click();
  await expect(page.locator('#trace-log')).toContainText('Shock Bonus');
});

test('lab bench controls spawn NPC AI, pause, clear trace, and reset actors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Lab' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  await page.locator('#lab-spawn-select').selectOption('spark-chaser');
  await page.getByRole('button', { name: 'Spawn' }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.some((player) => player.displayName === 'Spark Chaser') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_AI_TRACE__?.some((trace) => trace.actorName === 'Spark Chaser' && trace.kind === 'target') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_AI_TRACE__?.some((trace) => trace.actorName === 'Spark Chaser' && trace.kind === 'cast') ?? false))
    .toBeTruthy();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.waitForTimeout(100);
  const pausedTick = await page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBe(pausedTick);

  await page.getByRole('button', { name: 'Clear Trace' }).click();
  await expect.poll(async () => page.evaluate(() => (window.__BEAT_TRACE__?.length ?? 0) + (window.__BEAT_AI_TRACE__?.length ?? 0))).toBe(0);

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await page.getByRole('button', { name: 'Clear Actors' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);
});

test('lab physics preset materializes bodies and tethers actors', async ({ page }) => {
  await page.goto('/');
  await openWorkbench(page);
  await page.getByRole('tab', { name: 'Presets' }).click();
  await page.getByRole('button', { name: 'Physics' }).click();
  await expect(page.locator('#rules-inspector')).toContainText('Anchor Orb');
  await expect(page.locator('#rules-inspector')).toContainText('phase walls');
  await applyAndCloseWorkbench(page);
  await page.getByRole('button', { name: 'Lab' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  await page.keyboard.press('Space');
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.physicsBodies.some((body) => body.sourceAbilityId === 'anchor-orb') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.constraints.some((constraint) => constraint.kind === 'snare') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_TRACE__?.some((trace) => trace.kind === 'physics' && trace.physicsKind === 'snare') ?? false))
    .toBeTruthy();

  await pressGameKey(page, 'Digit2');
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.constraints.some((constraint) => constraint.kind === 'drag') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const snapshot = window.__BEAT_SNAPSHOT__;
        const player = snapshot?.players.find((candidate) => candidate.role === 'player');
        const body = snapshot?.physicsBodies.find((candidate) => candidate.sourceAbilityId === 'wrecking-weight');
        return player && body ? player.x - body.x : 0;
      }),
    )
    .toBeGreaterThan(0.7);
});

test('mobile touch can fire a physics ability', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await usePreset(page, 'Physics');
  await page.getByRole('button', { name: 'Lab' }).click();
  await expect.poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  const fire = await page.locator('#touch-fire').boundingBox();
  if (!fire) {
    throw new Error('touch fire pad missing');
  }
  await page.mouse.move(fire.x + fire.width / 2, fire.y + fire.height / 2);
  await page.mouse.down();
  await page.mouse.move(fire.x + fire.width / 2 + 46, fire.y + fire.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.physicsBodies.some((body) => body.sourceAbilityId === 'anchor-orb') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => page.evaluate(() => window.__BEAT_SNAPSHOT__?.constraints.some((constraint) => constraint.kind === 'snare') ?? false))
    .toBeTruthy();
});

test('host and client both see physics bodies and tethers', async ({ context, page: host }) => {
  const roomName = `Physics Sync ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await usePreset(host, 'Physics');
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await expect(roomRow).toContainText('rules');
  await expect(roomRow).toContainText('map');
  await expect(roomRow).toContainText('content');
  await roomRow.click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  await host.bringToFront();
  await aimCanvas(host, 'right');
  await pressGameKey(host, 'Space');
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.physicsBodies.some((body) => body.sourceAbilityId === 'anchor-orb') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.physicsBodies.some((body) => body.sourceAbilityId === 'anchor-orb') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.constraints.some((constraint) => constraint.kind === 'snare') ?? false))
    .toBeTruthy();
});

test('host and client sync platform movement', async ({ context, page: host }) => {
  const roomName = `Platform Sync ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await usePreset(host, 'Platform');
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.y ?? 0))
    .toBeGreaterThan(3);

  await host.bringToFront();
  await expect
    .poll(async () =>
      host.evaluate(() => {
        const player = window.__BEAT_SNAPSHOT__?.players.find((candidate) => candidate.displayName === 'Host');
        return Boolean(player && player.y > 3 && Math.abs(player.vy) < 0.25);
      }),
    )
    .toBeTruthy();
  await host.keyboard.down('KeyW');
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.vy ?? 0))
    .toBeLessThan(-1);
  await host.keyboard.up('KeyW');
});

test('mechanics status combo is visible in multiplayer combat', async ({ context, page: host }) => {
  const roomName = `Mechanics Lab ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await openAdvancedJson(host);
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
      targeting: 'aim-assist',
      damage: 12,
      cooldownTicks: 6,
      radius: 1.4,
      range: 60,
      speed: 3,
      lifetimeTicks: 40,
    });
    return `${JSON.stringify(rules, null, 2)}\n`;
  });
  await host.locator('#rules-json').fill(patchedRules);
  await applyAndCloseWorkbench(host);
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  await host.bringToFront();
  await aimCanvas(host, 'right');
  await pressGameKey(host, 'Space');
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.statuses.some((status) => status.id === 'shocked') ?? false))
    .toBeTruthy();
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.effects.some((effect) => effect.kind === 'trigger') ?? false))
    .toBeTruthy();
});

test('host and client both see configured session NPCs without changing room player count', async ({ context, page: host }) => {
  const roomName = `NPC Session ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await openAdvancedJson(host);
  const patchedRules = await host.locator('#rules-json').evaluate((node) => {
    const rules = JSON.parse((node as HTMLTextAreaElement).value) as {
      npcs: {
        sessionSpawns: Array<Record<string, unknown>>;
      };
    };
    rules.npcs.sessionSpawns = [{ id: 'session-dummy', archetypeId: 'training-dummy', x: 0, y: 4 }];
    return `${JSON.stringify(rules, null, 2)}\n`;
  });
  await host.locator('#rules-json').fill(patchedRules);
  await applyAndCloseWorkbench(host);
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.some((player) => player.role === 'npc' && player.displayName === 'Training Dummy') ?? false))
    .toBeTruthy();

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toContainText('1/6');
  await roomRow.click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(3);
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(3);
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.some((player) => player.role === 'npc' && player.displayName === 'Training Dummy') ?? false))
    .toBeTruthy();
});

test('authored effects are visible in multiplayer combat', async ({ context, page: host }) => {
  const roomName = `Effects Lab ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await openAdvancedJson(host);
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
      targeting: 'aim-assist',
      damage: 24,
      cooldownTicks: 6,
      radius: 1.4,
      range: 60,
      speed: 3,
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
  await applyAndCloseWorkbench(host);
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  const clientBeforeHitX = await host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0);
  await host.bringToFront();
  await aimCanvas(host, 'right');
  await pressGameKey(host, 'Space');
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.slotCooldownTicks[0] ?? 0)).toBeGreaterThan(0);
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.status?.slowTicks ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.x ?? 0))
    .toBeGreaterThan(clientBeforeHitX + 0.5);

  const hostHpBeforeHit = await host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.hp ?? 0);
  await client.bringToFront();
  await aimCanvas(client, 'left');
  await client.locator('.skill-slot[data-slot="0"]').click();
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Client')?.slotCooldownTicks[0] ?? 0)).toBeGreaterThan(0);
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

test('mobile client returns to menu when host leaves', async ({ context, page: host }) => {
  const roomName = `Host Leave Lab ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.setViewportSize({ width: 390, height: 844 });
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  await host.bringToFront();
  await host.getByRole('button', { name: 'Menu' }).click();
  await expect(client.locator('#menu-view')).toBeVisible();
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__ === undefined)).toBeTruthy();
});

test('multiplayer movement survives dropped snapshot packets', async ({ context, page: host }) => {
  await host.addInitScript(() => {
    const originalSend = RTCDataChannel.prototype.send;
    let snapshotSends = 0;
    RTCDataChannel.prototype.send = function patchedSend(this: RTCDataChannel, data: string | Blob | ArrayBuffer | ArrayBufferView) {
      if (this.label === 'beat-snapshot' && typeof data === 'string' && data.includes('"type":"snapshot"')) {
        snapshotSends += 1;
        if (snapshotSends % 2 === 0) {
          return;
        }
      }
      return originalSend.call(this, data);
    };
  });

  const roomName = `Drop Lab ${Date.now()}`;
  await host.goto('/');
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await host.getByRole('button', { name: 'Host' }).click();
  await expect.poll(async () => host.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(1);

  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  const roomRow = client.locator('.room-row').filter({ hasText: roomName });
  await expect(roomRow).toBeVisible();
  await roomRow.click();
  await expect.poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);

  const startX = await client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.x ?? 0);
  await host.bringToFront();
  await host.keyboard.down('KeyD');
  await expect
    .poll(async () => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.find((player) => player.displayName === 'Host')?.x ?? 0))
    .toBeGreaterThan(startX + 0.8);
  await host.keyboard.up('KeyD');
  await expect.poll(async () => client.evaluate(() => window.__BEAT_NET_STATS__?.lastSnapshotBytes ?? 0)).toBeGreaterThan(0);
});

async function aimCanvas(page: Page, side: 'left' | 'right'): Promise<void> {
  const canvas = await page.locator('#arena').boundingBox();
  if (!canvas) {
    throw new Error('arena canvas missing');
  }
  const x = side === 'right' ? canvas.x + canvas.width - 24 : canvas.x + 24;
  await page.mouse.move(x, canvas.y + canvas.height / 2);
}

async function openWorkbench(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Workbench' }).click();
  await expect(page.locator('#workbench-view')).toBeVisible();
}

async function openAdvancedJson(page: Page): Promise<void> {
  await openWorkbench(page);
  await page.getByRole('tab', { name: 'Advanced JSON' }).click();
  await expect(page.locator('#rules-json')).toBeVisible();
}

async function applyAndCloseWorkbench(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#menu-view')).toBeVisible();
}

async function usePreset(page: Page, name: string): Promise<void> {
  await openWorkbench(page);
  await page.getByRole('tab', { name: 'Presets' }).click();
  await page.getByRole('button', { name }).click();
  await applyAndCloseWorkbench(page);
}

async function pressGameKey(page: Page, code: string): Promise<void> {
  await page.evaluate((keyCode) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: keyCode, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: keyCode, bubbles: true }));
  }, code);
}
