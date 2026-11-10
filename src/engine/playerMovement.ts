import type { PlayerInput, Ruleset } from './protocol';
import { nextPlatformVelocity } from './platformMovement';

type Vec2 = { x: number; y: number };
type MovementInput = Pick<PlayerInput, 'moveX' | 'moveY' | 'aimDx' | 'aimDy'>;
export type MovementState = { position: Vec2; velocity: Vec2; facing: Vec2; jumpHeld: boolean };
export type MovementStatus = { movementMultiplier?: number; untilTick: number };

/** The authority and input replay use the same strongest-slow rule. */
export function movementMultiplier(statuses: Iterable<MovementStatus>, tick: number): number {
  let multiplier = 1;
  for (const status of statuses) {
    if (status.untilTick > tick && status.movementMultiplier !== undefined) multiplier = Math.min(multiplier, status.movementMultiplier);
  }
  return multiplier;
}

/** Desired velocity before Rapier integration; no world mutation or ability effects. */
export function nextPlayerMovement(state: MovementState, input: MovementInput, rules: Ruleset, speedMultiplier: number): Omit<MovementState, 'position'> {
  const axisX = clamp(input.moveX), axisY = clamp(input.moveY);
  const explicitAim = normalized(input.aimDx, input.aimDy);
  let facing = state.facing;
  let velocity: Vec2;
  let jumpHeld = state.jumpHeld;
  if (rules.player.movement.mode === 'platform') {
    const result = nextPlatformVelocity({
      axisX, axisY, speed: rules.player.speed, speedMultiplier, currentVelocity: state.velocity, position: state.position,
      radius: rules.player.radius, arena: rules.arena, obstacles: rules.obstacles, platform: rules.player.movement.platform, wasJumpPressed: state.jumpHeld,
    });
    velocity = result.velocity;
    jumpHeld = result.jumpPressed;
    if (rules.player.aim.mode === 'free' && explicitAim) facing = explicitAim;
    else if (Math.abs(axisX) > 0.05) facing = { x: Math.sign(axisX), y: 0 };
  } else if (rules.player.movement.mode === 'tank') {
    const turn = axisX * rules.player.movement.turnSpeedDegrees * Math.PI / 180 / rules.tickRate;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    if (Math.abs(turn) >= 0.0001) facing = normalized(facing.x * cos - facing.y * sin, facing.x * sin + facing.y * cos) ?? facing;
    const throttle = -axisY;
    const speed = rules.player.speed * speedMultiplier * throttle * (throttle < 0 ? rules.player.movement.reverseMultiplier : 1);
    velocity = { x: facing.x * speed, y: facing.y * speed };
  } else {
    let x = axisX, y = axisY;
    if (rules.player.movement.mode === 'orthogonal') {
      if (Math.abs(x) >= Math.abs(y)) y = 0;
      else x = 0;
    }
    const move = normalized(x, y);
    const speed = rules.player.speed * speedMultiplier;
    velocity = move ? { x: move.x * speed, y: move.y * speed } : { x: 0, y: 0 };
    if (rules.player.aim.mode === 'free' && explicitAim) facing = explicitAim;
    else if (move) facing = move;
  }
  return { velocity, facing, jumpHeld };
}

export function playerAim(input: MovementInput, facing: Vec2, rules: Ruleset['player']): Vec2 {
  if (rules.aim.mode === 'facing') return facing;
  return normalized(input.aimDx, input.aimDy) ??
    (rules.movement.mode === 'tank' ? undefined : normalized(input.moveX, input.moveY)) ?? facing;
}

function clamp(value: number): number { return Math.max(-1, Math.min(1, value)); }
function normalized(x: number, y: number): Vec2 | undefined {
  const length = Math.hypot(x, y);
  return length >= 0.001 ? { x: x / length, y: y / length } : undefined;
}
