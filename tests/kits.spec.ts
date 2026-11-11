import { expect, type Page, test } from '@playwright/test';
import type { Ruleset } from '../src/engine/protocol';

async function rules(page: Page): Promise<Ruleset> {
  return JSON.parse(await page.locator('#rules-json').inputValue()) as Ruleset;
}

test('match kits rebuild swaps and chips, then preserve manual customization', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
  const duel = page.locator('[data-kit-match="duel"]');
  await duel.focus();
  await page.keyboard.press('Enter');
  await expect(duel).toHaveAttribute('aria-pressed', 'true');
  const base = await rules(page);
  expect(base.maxPlayers).toBe(2);
  await page.getByLabel('Turbo Cooldowns').check();
  expect((await rules(page)).abilities[0].cooldownTicks).toBe(6);
  await page.getByLabel('Turbo Cooldowns').uncheck();
  expect(await rules(page)).toEqual(base);
  await page.getByLabel('Turbo Cooldowns').check();
  await page.getByLabel('Giant Projectiles').check();
  await page.getByLabel('Strong Knockback').check();
  await page.getByRole('button', { name: 'Change / tune movement', exact: true }).click();
  await page.getByLabel('Heavy Tank').check();
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByText('Swap ability cards', { exact: true }).click();
  await page.locator('#kit-slot-0').focus();
  await page.locator('#kit-slot-0').selectOption('anchor-orb');
  expect(await rules(page)).toMatchObject({ player: { movement: { mode: 'tank' }, aim: { mode: 'facing' } }, loadout: { abilityIds: ['anchor-orb', 'arc-slash', 'blink-step', 'ion-lance'] } });
  await expect(page.locator('#kit-slot-0')).toBeFocused();
  await page.getByRole('button', { name: 'Inspect / customize ability 1', exact: true }).click();
  await expect(page.locator('#workbench-ability-select')).toHaveValue('anchor-orb');
  await page.locator('#workbench-ability-cooldown').fill('17');
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('#kit-status')).toContainText('Custom rules are kept');
  await expect(page.getByLabel('Turbo Cooldowns')).toBeDisabled();
  await expect(page.locator('[data-current-slot="0"]')).toContainText('Anchor Orb');
  await expect(page.getByRole('button', { name: 'Inspect / customize ability 1', exact: true })).toBeEnabled();
  await expect(duel).toHaveAttribute('aria-pressed', 'false');
  expect((await rules(page)).abilities.find((ability) => ability.id === 'anchor-orb')?.cooldownTicks).toBe(17);
  await page.locator('[data-kit-match="hill"]').click();
  expect(await rules(page)).toMatchObject({ player: { movement: { mode: 'twinStick' } }, objectives: [{ kind: 'kingZone' }] });
  await expect(page.getByLabel('Turbo Cooldowns')).not.toBeChecked();
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(3);
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.objectives[0]?.kind)).toBe('kingZone');
});

test('mobile bouncy relic kit hosts shared rules and a moving ball', async ({ page: host, context }, testInfo) => {
  await host.setViewportSize({ width: 390, height: 844 });
  await host.goto('/');
  const roomName = `Bouncy kit ${Date.now()}`;
  await host.locator('#display-name').fill('Host');
  await host.locator('#room-name').fill(roomName);
  await host.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await host.locator('[data-kit-match="relic"]').click();
  await host.getByLabel('Bouncy Relic').check();
  await host.getByLabel('Turbo Cooldowns').check();
  const compiled = await rules(host);
  expect(compiled.objectives[0]).toMatchObject({ body: { restitution: 0.92 } });
  expect(await host.locator('#workbench-view').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await host.locator('#kit-status').scrollIntoViewIfNeeded();
  await host.screenshot({ path: testInfo.outputPath('mobile-match-kits.png') });
  await host.getByRole('button', { name: 'Host room', exact: true }).click();
  await expect.poll(() => host.evaluate(() => window.__BEAT_SNAPSHOT__?.physicsBodies.length ?? 0)).toBe(1);
  const client = await context.newPage();
  await client.goto('/');
  await client.locator('#display-name').fill('Client');
  await client.locator('.room-row').filter({ hasText: roomName }).click();
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.players.length ?? 0)).toBe(2);
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.objectives[0]?.kind)).toBe('relicPush');
  await host.bringToFront();
  // Fire slot 1 (Pulse Bolt) from spawn (-12, 0) aiming right toward the center relic (0, 0) to strike the ball from afar
  const arena = await host.locator('#arena').boundingBox();
  if (!arena) throw new Error('arena canvas missing');
  await host.mouse.move(arena.x + arena.width - 24, arena.y + arena.height / 2);
  await host.keyboard.press('Space');
  await expect.poll(() => host.evaluate(() => window.__BEAT_SNAPSHOT__?.objectives[0]?.x ?? 0), { timeout: 7000 }).toBeGreaterThan(2);
  await expect.poll(() => client.evaluate(() => window.__BEAT_SNAPSHOT__?.objectives[0]?.x ?? 0)).toBeGreaterThan(2);
  await client.bringToFront();
  const motion = await client.evaluate(() => new Promise<Array<{ tick: number; x: number; objectiveX: number }>>((resolve) => {
    const samples: Array<{ tick: number; x: number; objectiveX: number }> = [];
    const until = performance.now() + 500;
    const sample = () => {
      const authoritative = window.__BEAT_SNAPSHOT__;
      const rendered = window.__BEAT_RENDER_SNAPSHOT__;
      const body = rendered?.physicsBodies[0];
      if (authoritative && body && rendered?.objectives[0]) samples.push({ tick: authoritative.tick, x: body.x, objectiveX: rendered.objectives[0].x });
      if (performance.now() < until) requestAnimationFrame(sample);
      else resolve(samples);
    };
    requestAnimationFrame(sample);
  }));
  expect(motion.some((sample, index) => index > 0 && motion[index - 1].tick === sample.tick && Math.abs(motion[index - 1].x - sample.x) > 0.00001)).toBe(true);
  expect(motion.every((sample) => sample.x === sample.objectiveX)).toBe(true);
  await host.getByRole('button', { name: 'Menu', exact: true }).click();
  await host.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await expect(host.locator('#kit-bouncy')).toBeChecked();
  expect(await rules(host)).toEqual(compiled);
});

test('editing JSON detaches a kit without replacing the draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose match / experiment', exact: true }).click();
  await page.locator('[data-kit-match="duel"]').click();
  await page.getByRole('button', { name: 'Customize / JSON', exact: true }).click();
  const customized = await rules(page);
  customized.name = 'My Duel';
  await page.locator('#rules-json').fill(JSON.stringify(customized));
  await expect(page.locator('#rules-hash-line')).toContainText('My Duel');
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.locator('#kit-status')).toContainText('Custom rules are kept');
  expect((await rules(page)).name).toBe('My Duel');
  await page.getByRole('button', { name: 'Customize / JSON', exact: true }).click();
  await page.locator('#rules-json').fill('{"unfinished":');
  await expect(page.locator('#rules-validation-line')).toContainText('invalid');
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await expect(page.locator('#workbench-view')).toBeVisible();
  await expect(page.locator('#rules-json')).toHaveValue('{"unfinished":');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#menu-current-rules')).toContainText('Invalid JSON draft');
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(page.locator('#rules-json')).toBeVisible();
  await expect(page.locator('#rules-json')).toHaveValue('{"unfinished":');
});

test('one library keeps original experiments and mutator/swap options active', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Quick presets' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose match / experiment' }).click();
  await expect(page.getByRole('tab', { name: 'Presets', exact: true })).toHaveCount(0);
  await page.locator('[data-kit-match="duel"]').click();
  const kit = await rules(page);
  await page.screenshot({ path: testInfo.outputPath('library-matches.png') });
  await page.getByRole('button', { name: 'Experiments', exact: true }).click();
  await expect(page.locator('[data-library-content="matches"]')).toBeHidden();
  await expect(page.locator('[data-library-content="experiments"]')).toBeVisible();
  expect(await rules(page)).toEqual(kit);
  const duelPreset = page.locator('[data-experiment="duel-preset"]');
  await duelPreset.click();
  await expect(duelPreset).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Turbo Cooldowns')).toBeEnabled();
  const original = await rules(page);
  expect(original.mechanics.triggers.length).toBeGreaterThan(0);
  expect(original.obstacles).not.toEqual(kit.obstacles);
  await expect(page.locator('#kit-current')).toContainText('Beat Duel');
  await expect(page.locator('[data-experiment="bleed-dot"]')).toHaveCount(0);
  const bleed = page.getByRole('checkbox', { name: /Bleed Over Time/ });
  await bleed.check();
  await expect(bleed).toBeChecked();
  await expect(page.getByLabel('Turbo Cooldowns')).toBeEnabled();
  expect((await rules(page)).mechanics.statuses.some((status) => status.id === 'bleeding')).toBe(true);
  await page.getByLabel('Turbo Cooldowns').check();
  expect((await rules(page)).abilities[0].cooldownTicks).toBe(6);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#menu-current-rules')).toContainText('Beat Duel');
  await page.getByRole('button', { name: 'Choose match / experiment' }).click();
  await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#kit-current')).toContainText('Beat Duel');
});

test('streamlined abilities and mechanics tabs edit match kits without dead inputs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose match / experiment' }).click();
  await page.locator('[data-kit-match="duel"]').click();

  // Ability overview and existing editors share the accepted rules.
  await page.getByRole('button', { name: 'Inspect / customize ability 4', exact: true }).click();
  await expect(page.locator('[data-loadout-slot]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Ability overview' })).toContainText('Self dash');
  await expect(page.locator('#workbench-ability-select')).toHaveValue('ion-lance');
  await page.locator('#workbench-ability-damage').fill('50');
  await page.locator('#workbench-effect-0-distance').fill('4');
  expect((await rules(page)).abilities.find((ability) => ability.id === 'ion-lance')?.effects).toEqual([{ kind: 'selfDash', distance: 4 }]);

  // Re-select duel kit and inspect Mechanics tab
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.locator('[data-kit-match="duel"]').click();
  await page.getByRole('tab', { name: 'Mechanics' }).click();
  await expect(page.locator('#workbench-trigger-fields')).toBeHidden();
  await expect(page.locator('#workbench-remove-trigger')).toBeDisabled();

  // Toggle Low HP Execute on from Mechanics tab while keeping kit attached
  await page.getByRole('checkbox', { name: /Low HP Execute/ }).check();
  await expect(page.locator('#workbench-trigger-fields')).toBeVisible();
  await expect(page.locator('#workbench-remove-trigger')).toBeEnabled();
  expect((await rules(page)).mechanics.triggers.map((t) => t.id)).toEqual(['low-hp-execute']);

  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.getByLabel('Turbo Cooldowns')).toBeEnabled();

  // Custom trigger add/remove in Mechanics tab
  await page.getByRole('tab', { name: 'Mechanics' }).click();
  await page.getByRole('checkbox', { name: /Low HP Execute/ }).uncheck();
  await expect(page.locator('#workbench-trigger-fields')).toBeHidden();
  await page.locator('#workbench-add-trigger').click();
  await expect(page.locator('#workbench-trigger-fields')).toBeVisible();
  await expect(page.locator('#workbench-trigger-select')).toHaveValue('custom-trigger-1');
  await page.locator('#workbench-remove-trigger').click();
  await expect(page.locator('#workbench-trigger-fields')).toBeHidden();
});

test('ability nodes explain edited rules, open triggers, and launch the loadout in Lab', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose match / experiment' }).click();
  await page.locator('[data-kit-match="duel"]').click();
  await page.getByRole('checkbox', { name: /Combo Mechanics/ }).check();
  await page.getByRole('button', { name: 'Inspect / customize ability 4', exact: true }).click();
  const overview = page.getByRole('region', { name: 'Ability overview' });
  await expect(overview).toContainText('Hold → release / auto-release');
  await expect(overview).toContainText('2.2 m');
  await expect(overview.getByRole('heading', { name: 'Ion Lance', exact: true })).toBeInViewport();
  await expect(overview.getByRole('img')).toHaveAccessibleName('Ion Lance hit shape schematic');
  await page.screenshot({ path: testInfo.outputPath('ion-lance-desktop.png'), fullPage: true });
  await overview.getByRole('link', { name: /Self dash/ }).click();
  await expect(page.locator('#workbench-effect-0-distance')).toBeInViewport();
  await page.locator('#workbench-effect-0-distance').fill('4');
  await expect(overview).toContainText('4 m');
  await overview.locator('[data-inspect-trigger="lance-heat"]').click();
  await expect(page.getByRole('tab', { name: 'Mechanics' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#workbench-trigger-select')).toHaveValue('lance-heat');
  await page.getByRole('tab', { name: 'Abilities' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await overview.scrollIntoViewIfNeeded();
  expect(await page.locator('#workbench-view').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ion-lance-mobile.png'), fullPage: true });
  await overview.getByRole('button', { name: 'Try this loadout in Lab' }).click();
  await expect(page.locator('#lab-controls')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__BEAT_SNAPSHOT__?.tick ?? 0)).toBeGreaterThan(2);
});

test('movement packages and mechanic addons preserve custom rules and respect invalid drafts', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Choose match / experiment' }).click();
  await page.locator('[data-kit-match="duel"]').click();
  await page.getByRole('button', { name: 'Change / tune movement' }).click();
  await expect(page.locator('[data-movement-package]')).toHaveCount(4);
  await page.locator('#workbench-player-hp').fill('83'); // Detach recipe.
  await page.getByRole('radio', { name: /Heavy Tank/ }).check();
  expect((await rules(page)).player).toMatchObject({ maxHp: 83, movement: { mode: 'tank' } });
  await page.getByRole('tab', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Experiments', exact: true }).click();
  await expect(page.locator('[data-library-content="experiments"] [data-experiment]')).toHaveCount(6);
  const before = await rules(page);
  await page.getByRole('checkbox', { name: /Low HP Execute/ }).check();
  const after = await rules(page);
  expect(after.player).toEqual(before.player);
  expect(after.objectives).toEqual(before.objectives);
  expect(after.mechanics.triggers.map((entry) => entry.id)).toEqual(['low-hp-execute']);
  await page.screenshot({ path: testInfo.outputPath('library-packages.png'), fullPage: true });
  await page.getByRole('button', { name: 'Customize / JSON' }).click();
  await page.locator('#rules-json').fill('{"unfinished":');
  await page.getByRole('tab', { name: 'Player' }).click();
  await expect(page.getByRole('radio', { name: /Heavy Tank/ })).toBeDisabled();
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.getByRole('checkbox', { name: /Low HP Execute/ })).toBeDisabled();
  await expect(page.locator('#rules-json')).toHaveValue('{"unfinished":');
});
