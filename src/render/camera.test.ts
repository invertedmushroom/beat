import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from '../engine/defaultRules';
import { createCameraState, viewportToWorld, worldToViewport } from './camera';

describe('camera transforms', () => {
  it('round-trips world and viewport coordinates', () => {
    const ruleset = createDefaultRuleset();
    const camera = createCameraState(ruleset, 800, 600, { x: 3, y: -2 }, 2);
    const viewport = worldToViewport(camera, 4.25, -1.5);
    const world = viewportToWorld(camera, viewport.x, viewport.y);

    expect(world.x).toBeCloseTo(4.25);
    expect(world.y).toBeCloseTo(-1.5);
  });

  it('clamps the followed target to arena bounds when zoomed in', () => {
    const ruleset = createDefaultRuleset();
    const camera = createCameraState(ruleset, 800, 600, { x: 1000, y: -1000 }, 4);
    const visibleWidth = camera.viewportWidth / camera.scale;
    const visibleHeight = camera.viewportHeight / camera.scale;

    expect(camera.x).toBeLessThanOrEqual(ruleset.arena.width / 2 - visibleWidth / 2);
    expect(camera.y).toBeGreaterThanOrEqual(-ruleset.arena.height / 2 + visibleHeight / 2);
  });

  it('keeps the old centered framing when the full arena is visible', () => {
    const ruleset = createDefaultRuleset();
    const camera = createCameraState(ruleset, 800, 600, { x: 3, y: -2 }, 1);

    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(worldToViewport(camera, 0, 0)).toEqual({ x: 400, y: 300 });
  });
});
