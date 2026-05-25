import { describe, expect, it } from 'vitest';
import { createDefaultRuleset } from './defaultRules';
import { applyPlatformGravity, isPlatformGrounded, nextPlatformVelocity } from './platformMovement';

describe('platform movement helpers', () => {
  it('falls under gravity and clamps max fall speed', () => {
    const ruleset = platformRuleset();
    const velocity = applyPlatformGravity({ x: 0, y: 17.8 }, ruleset.player.movement.platform.gravity, ruleset.player.movement.platform.maxFallSpeed, 1 / 30);

    expect(velocity.y).toBe(ruleset.player.movement.platform.maxFallSpeed);
  });

  it('jumps only from grounded state and only once per press', () => {
    const ruleset = platformRuleset();
    const first = nextPlatformVelocity({
      axisX: 0,
      axisY: -1,
      speed: ruleset.player.speed,
      speedMultiplier: 1,
      currentVelocity: { x: 0, y: 0 },
      position: { x: 0, y: ruleset.arena.height / 2 - ruleset.player.radius },
      radius: ruleset.player.radius,
      arena: ruleset.arena,
      obstacles: ruleset.obstacles,
      platform: ruleset.player.movement.platform,
      wasJumpPressed: false,
    });
    const held = nextPlatformVelocity({
      axisX: 0,
      axisY: -1,
      speed: ruleset.player.speed,
      speedMultiplier: 1,
      currentVelocity: { x: 0, y: -6 },
      position: { x: 0, y: ruleset.arena.height / 2 - ruleset.player.radius },
      radius: ruleset.player.radius,
      arena: ruleset.arena,
      obstacles: ruleset.obstacles,
      platform: ruleset.player.movement.platform,
      wasJumpPressed: true,
    });

    expect(first.velocity.y).toBe(-ruleset.player.movement.platform.jumpVelocity);
    expect(held.velocity.y).toBe(-6);
  });

  it('uses reduced horizontal air control', () => {
    const ruleset = platformRuleset();
    const result = nextPlatformVelocity({
      axisX: 1,
      axisY: 0,
      speed: ruleset.player.speed,
      speedMultiplier: 1,
      currentVelocity: { x: 0, y: 4 },
      position: { x: 0, y: 0 },
      radius: ruleset.player.radius,
      arena: ruleset.arena,
      obstacles: ruleset.obstacles,
      platform: ruleset.player.movement.platform,
      wasJumpPressed: false,
    });

    expect(result.grounded).toBe(false);
    expect(result.velocity.x).toBeCloseTo(ruleset.player.speed * ruleset.player.movement.platform.airControl);
  });

  it('detects obstacle tops as ground probes', () => {
    const ruleset = platformRuleset();
    const platform = { id: 'ledge', x: 0, y: 4, halfWidth: 3, halfHeight: 0.4 };

    expect(
      isPlatformGrounded(
        { x: 0, y: platform.y - platform.halfHeight - ruleset.player.radius + 0.03 },
        ruleset.player.radius,
        ruleset.arena,
        [platform],
        ruleset.player.movement.platform.groundProbeDistance,
      ),
    ).toBe(true);
  });
});

function platformRuleset() {
  const ruleset = createDefaultRuleset();
  ruleset.player.movement.mode = 'platform';
  ruleset.player.damping = 0.35;
  return ruleset;
}
