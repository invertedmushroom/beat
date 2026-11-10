import RAPIER from '@dimforge/rapier2d-compat';
import { initializeRapier } from '../engine/rapier';
import type { PlayerSnapshot, Ruleset } from '../engine/protocol';

export const MAX_REMOTE_PREDICTION_TICKS = 3;

/** An isolated visual world: static arena plus one swept player, never gameplay state. */
export class CollisionPrediction {
  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;

  static async create(rules: Ruleset): Promise<CollisionPrediction> {
    await initializeRapier();
    return new CollisionPrediction(rules);
  }

  private constructor(private readonly rules: Ruleset) {
    this.world = new RAPIER.World({ x: 0, y: rules.player.movement.mode === 'platform' ? rules.player.movement.platform.gravity : 0 });
    const halfW = rules.arena.width / 2;
    const halfH = rules.arena.height / 2;
    const wall = 0.55;
    for (const box of [
      { x: 0, y: -halfH - wall, halfWidth: halfW + wall, halfHeight: wall },
      { x: 0, y: halfH + wall, halfWidth: halfW + wall, halfHeight: wall },
      { x: -halfW - wall, y: 0, halfWidth: wall, halfHeight: halfH + wall },
      { x: halfW + wall, y: 0, halfWidth: wall, halfHeight: halfH + wall },
      ...rules.obstacles,
    ]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(box.halfWidth, box.halfHeight).setTranslation(box.x, box.y));
    }
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).lockRotations().setCanSleep(false));
    this.world.createCollider(RAPIER.ColliderDesc.ball(rules.player.radius).setFriction(0).setRestitution(0), this.body);
  }

  predict(player: PlayerSnapshot, seconds: number): Pick<PlayerSnapshot, 'x' | 'y' | 'vx' | 'vy'> {
    if (!player.alive) return player;
    const dt = 1 / this.rules.tickRate;
    let remaining = Math.min(Math.max(0, seconds), MAX_REMOTE_PREDICTION_TICKS * dt);
    // Replay from the authoritative anchor each render; elapsed time is never integrated twice.
    this.body.setTranslation({ x: player.x, y: player.y }, true);
    this.body.setLinearDamping(0);
    this.body.setLinvel({ x: player.vx, y: player.vy }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    while (remaining > 0.000001) {
      this.world.timestep = Math.min(dt, remaining);
      this.world.step();
      if (this.rules.player.movement.mode === 'platform') {
        const velocity = this.body.linvel();
        this.body.setLinvel({ x: velocity.x, y: Math.min(velocity.y, this.rules.player.movement.platform.maxFallSpeed) }, true);
      }
      remaining -= this.world.timestep;
    }
    const position = this.body.translation();
    const velocity = this.body.linvel();
    return { x: position.x, y: position.y, vx: velocity.x, vy: velocity.y };
  }

  stepLocal = (state: { x: number; y: number }, velocity: { x: number; y: number }): Pick<PlayerSnapshot, 'x' | 'y' | 'vx' | 'vy'> => {
    this.body.setTranslation(state, true);
    this.body.setLinearDamping(this.rules.player.damping);
    this.body.setLinvel(velocity, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.world.timestep = 1 / this.rules.tickRate;
    this.world.step();
    const position = this.body.translation(), nextVelocity = this.body.linvel();
    return { x: position.x, y: position.y, vx: nextVelocity.x,
      vy: this.rules.player.movement.mode === 'platform' ? Math.min(nextVelocity.y, this.rules.player.movement.platform.maxFallSpeed) : nextVelocity.y };
  };

  destroy(): void {
    this.world.free();
  }
}
