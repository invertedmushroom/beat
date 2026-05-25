import type { RectObstacle, Ruleset } from './protocol';

export type Vec2 = { x: number; y: number };

export type PlatformMoveInput = {
  axisX: number;
  axisY: number;
  speed: number;
  speedMultiplier: number;
  currentVelocity: Vec2;
  position: Vec2;
  radius: number;
  arena: Ruleset['arena'];
  obstacles: RectObstacle[];
  platform: Ruleset['player']['movement']['platform'];
  wasJumpPressed: boolean;
};

export type PlatformMoveResult = {
  velocity: Vec2;
  grounded: boolean;
  jumpPressed: boolean;
};

export function nextPlatformVelocity(input: PlatformMoveInput): PlatformMoveResult {
  const grounded = isPlatformGrounded(input.position, input.radius, input.arena, input.obstacles, input.platform.groundProbeDistance);
  const jumpPressed = input.axisY < -0.55;
  const horizontalScale = grounded ? 1 : input.platform.airControl;
  const velocity = {
    x: input.axisX * input.speed * input.speedMultiplier * horizontalScale,
    y: Math.min(input.currentVelocity.y, input.platform.maxFallSpeed),
  };

  if (jumpPressed && !input.wasJumpPressed && grounded) {
    velocity.y = -input.platform.jumpVelocity;
  }

  return {
    velocity,
    grounded,
    jumpPressed,
  };
}

export function applyPlatformGravity(velocity: Vec2, gravity: number, maxFallSpeed: number, dt: number): Vec2 {
  return {
    x: velocity.x,
    y: Math.min(maxFallSpeed, velocity.y + gravity * dt),
  };
}

export function isPlatformGrounded(
  position: Vec2,
  radius: number,
  arena: Ruleset['arena'],
  obstacles: RectObstacle[],
  probeDistance: number,
): boolean {
  const probe = Math.max(0.01, probeDistance);
  const footY = position.y + radius;
  const arenaFloorY = arena.height / 2;
  if (footY >= arenaFloorY - probe) {
    return true;
  }

  return obstacles.some((obstacle) => {
    const topY = obstacle.y - obstacle.halfHeight;
    const horizontallyAligned =
      position.x + radius * 0.72 >= obstacle.x - obstacle.halfWidth && position.x - radius * 0.72 <= obstacle.x + obstacle.halfWidth;
    const closeToTop = footY >= topY - probe && footY <= topY + probe * 1.8;
    return horizontallyAligned && closeToTop && position.y < topY + radius;
  });
}
