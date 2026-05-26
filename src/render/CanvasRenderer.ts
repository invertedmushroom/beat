import type { EngineSnapshot, Ruleset } from '../engine/protocol';
import { createCameraState, viewportToWorld, worldToViewport, type CameraState, type Vec2 } from './camera';

export type PickedActor = {
  id: string;
  role: EngineSnapshot['players'][number]['role'];
  x: number;
  y: number;
  distance: number;
};

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private snapshot?: EngineSnapshot;
  private ruleset?: Ruleset;
  private frame?: number;
  private localPlayerId?: string;
  private emptyMessage = 'No room active';
  private snapshotProvider?: () => EngineSnapshot | undefined;
  private cameraZoom = 1;
  private aimGhost?: Vec2;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2d canvas unavailable');
    }
    this.ctx = context;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setRuleset(ruleset: Ruleset | undefined): void {
    this.ruleset = ruleset;
    if (!ruleset) {
      this.snapshot = undefined;
    }
  }

  setLocalPlayer(playerId: string | undefined): void {
    this.localPlayerId = playerId;
  }

  setEmptyMessage(message: string): void {
    this.emptyMessage = message;
  }

  setSnapshotProvider(provider: (() => EngineSnapshot | undefined) | undefined): void {
    this.snapshotProvider = provider;
  }

  /**
   * Sets a transient world-space aim preview marker (e.g. pen hover).
   * Pass `undefined` to clear. Rendered on top of the snapshot but below HUD.
   */
  setAimGhost(point: Vec2 | undefined): void {
    this.aimGhost = point ? { x: point.x, y: point.y } : undefined;
  }

  resizeNow(): void {
    this.resize();
  }

  worldToClient(x: number, y: number): { x: number; y: number } | undefined {
    const camera = this.cameraForCurrentViewport();
    if (!camera) {
      return undefined;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = worldToViewport(camera, x, y);
    return {
      x: rect.left + point.x,
      y: rect.top + point.y,
    };
  }

  clientToWorld(clientX: number, clientY: number): Vec2 | undefined {
    const camera = this.cameraForCurrentViewport();
    if (!camera) {
      return undefined;
    }
    const rect = this.canvas.getBoundingClientRect();
    return viewportToWorld(camera, clientX - rect.left, clientY - rect.top);
  }

  setCameraZoom(zoom: number): void {
    this.cameraZoom = Math.max(0.1, Math.min(8, zoom));
  }

  pickActorAtClient(clientX: number, clientY: number): PickedActor | undefined {
    const world = this.clientToWorld(clientX, clientY);
    const snapshot = this.snapshot;
    const ruleset = this.ruleset;
    if (!world || !snapshot || !ruleset) {
      return undefined;
    }
    const pickRadius = ruleset.player.radius * 1.35;
    let picked: PickedActor | undefined;
    for (const player of snapshot.players) {
      const distance = Math.hypot(player.x - world.x, player.y - world.y);
      if (distance <= pickRadius && (!picked || distance < picked.distance)) {
        picked = {
          id: player.playerId,
          role: player.role,
          x: player.x,
          y: player.y,
          distance,
        };
      }
    }
    return picked;
  }

  update(snapshot: EngineSnapshot): void {
    this.snapshot = snapshot;
  }

  start(): void {
    const loop = () => {
      this.draw();
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  destroy(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    window.removeEventListener('resize', this.resize);
  }

  private readonly resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * scale));
    this.canvas.height = Math.max(1, Math.floor(rect.height * scale));
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
  };

  private draw(): void {
    const providedSnapshot = this.snapshotProvider?.();
    if (providedSnapshot) {
      this.snapshot = providedSnapshot;
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = '#141414';
    this.ctx.fillRect(0, 0, width, height);

    if (!this.ruleset) {
      this.drawCentered(this.emptyMessage);
      return;
    }

    const camera = this.cameraForFrame(width, height);

    this.drawGrid(camera, width, height);
    this.drawArena(camera);

    for (const obstacle of this.ruleset.obstacles) {
      const topLeft = worldToViewport(camera, obstacle.x - obstacle.halfWidth, obstacle.y - obstacle.halfHeight);
      this.ctx.fillStyle = '#30302d';
      this.ctx.strokeStyle = '#5d5a4f';
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(topLeft.x, topLeft.y, obstacle.halfWidth * 2 * camera.scale, obstacle.halfHeight * 2 * camera.scale);
      this.ctx.strokeRect(topLeft.x, topLeft.y, obstacle.halfWidth * 2 * camera.scale, obstacle.halfHeight * 2 * camera.scale);
    }

    this.drawObjectives(camera);

    const local = this.snapshot?.players.find((player) => player.playerId === this.localPlayerId);
    if (local?.alive) {
      this.drawLocalTelegraph(local, camera);
    }

    for (const effect of this.snapshot?.effects ?? []) {
      const { x, y } = worldToViewport(camera, effect.x, effect.y);
      const progress = effect.lifetimeTicks > 0 ? effect.ageTicks / effect.lifetimeTicks : 1;
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, 1 - progress);
      this.ctx.beginPath();
      this.ctx.strokeStyle = effect.color;
      this.ctx.lineWidth = effect.kind === 'melee' ? 2 : effect.kind === 'death' ? 4 : effect.kind === 'slow' ? 2 : 3;
      const pulseScale = effect.kind === 'dash' || effect.kind === 'knockback' ? 0.85 + progress * 0.95 : 0.7 + progress * 0.55;
      this.ctx.arc(x, y, effect.radius * camera.scale * pulseScale, 0, Math.PI * 2);
      this.ctx.stroke();
      if (effect.kind === 'death' || effect.kind === 'heal') {
        this.ctx.globalAlpha = Math.max(0, 0.28 - progress * 0.28);
        this.ctx.fillStyle = effect.color;
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    this.drawConstraints(camera);
    this.drawPhysicsBodies(camera);

    for (const projectile of this.snapshot?.projectiles ?? []) {
      const { x, y } = worldToViewport(camera, projectile.x, projectile.y);
      this.ctx.beginPath();
      this.ctx.fillStyle = projectile.color;
      this.ctx.shadowColor = projectile.color;
      this.ctx.shadowBlur = 12;
      this.ctx.arc(x, y, Math.max(3, projectile.radius * camera.scale), 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }

    for (const player of this.snapshot?.players ?? []) {
      const { x, y } = worldToViewport(camera, player.x, player.y);
      const radius = this.ruleset.player.radius * camera.scale;
      if (player.statuses.length > 0) {
        this.drawStatusRings(x, y, radius, player.statuses);
      }
      if (player.status?.slowTicks) {
        this.drawSlowAura(x, y, radius, player.status.slowColor, player.status.slowMultiplier);
      }
      if (player.charging) {
        this.drawChargeAura(x, y, radius, player.charging.ratio, player.charging.abilityId);
      }
      this.ctx.beginPath();
      this.ctx.fillStyle = player.alive ? actorFill(player.hue, player.role) : '#55524a';
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.lineWidth = player.playerId === this.localPlayerId ? 3 : 1.5;
      this.ctx.strokeStyle = player.playerId === this.localPlayerId ? '#ffe66d' : actorStroke(player.role, player.alive);
      if (player.role === 'dummy' || player.role === 'npc') {
        this.ctx.setLineDash([4, 3]);
      }
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      if (player.alive) {
        this.drawFacingPointer(x, y, radius, player.facingDx, player.facingDy);
      }

      this.ctx.font = '12px ui-sans-serif, system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#f5f3ed';
      this.ctx.fillText(player.displayName, x, y - radius - 9);
      this.drawHpBar(x, y + radius + 9, radius * 2.6, player.hp, player.maxHp, player.alive);
      this.drawResourceBars(x, y + radius + 16, radius * 2.6, player.resources);
      if (!player.alive) {
        this.drawDeathLabel(player, x, y, radius);
      }
    }

    for (const text of this.snapshot?.combatTexts ?? []) {
      const { x, y } = worldToViewport(camera, text.x, text.y);
      const progress = text.lifetimeTicks > 0 ? text.ageTicks / text.lifetimeTicks : 1;
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, 1 - progress);
      this.ctx.font = '700 15px ui-sans-serif, system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.lineWidth = 3;
      this.ctx.strokeStyle = '#141414';
      this.ctx.fillStyle = text.color;
      const label =
        text.kind === 'resource'
          ? `${text.amount > 0 ? '+' : ''}${Math.round(text.amount)}`
          : `${text.kind === 'heal' ? '+' : '-'}${Math.round(text.amount)}`;
      this.ctx.strokeText(label, x, y - progress * 18);
      this.ctx.fillText(label, x, y - progress * 18);
      this.ctx.restore();
    }

    if (this.aimGhost) {
      const local = this.snapshot?.players.find((p) => p.playerId === this.localPlayerId);
      const target = worldToViewport(camera, this.aimGhost.x, this.aimGhost.y);
      this.ctx.save();
      this.ctx.globalAlpha = 0.65;
      this.ctx.strokeStyle = '#ffe66d';
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([4, 3]);
      if (local?.alive) {
        const origin = worldToViewport(camera, local.x, local.y);
        this.ctx.beginPath();
        this.ctx.moveTo(origin.x, origin.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
      }
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      this.ctx.arc(target.x, target.y, 7, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(target.x - 10, target.y);
      this.ctx.lineTo(target.x + 10, target.y);
      this.ctx.moveTo(target.x, target.y - 10);
      this.ctx.lineTo(target.x, target.y + 10);
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.ctx.font = '12px ui-monospace, monospace';
    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = '#b9b4a8';
    this.ctx.fillText(`tick ${this.snapshot?.tick ?? 0}`, 16, height - 18);
  }

  private drawHpBar(x: number, y: number, width: number, hp: number, maxHp: number, alive: boolean): void {
    const height = 4;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.ctx.fillStyle = '#1b1b18';
    this.ctx.fillRect(x - width / 2, y, width, height);
    this.ctx.fillStyle = alive ? '#2fd17c' : '#6a6760';
    this.ctx.fillRect(x - width / 2, y, width * ratio, height);
  }

  private drawFacingPointer(x: number, y: number, radius: number, dx: number, dy: number): void {
    const facing = normalized(dx, dy);
    if (!facing) {
      return;
    }
    this.ctx.save();
    this.ctx.strokeStyle = '#141414';
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + facing.x * radius * 1.45, y + facing.y * radius * 1.45);
    this.ctx.stroke();
    this.ctx.strokeStyle = '#f5f3ed';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + facing.x * radius * 1.35, y + facing.y * radius * 1.35);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSlowAura(x: number, y: number, radius: number, color: string, multiplier: number): void {
    const strength = Math.max(0, Math.min(1, 1 - multiplier));
    this.ctx.save();
    this.ctx.globalAlpha = 0.12 + strength * 0.2;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 1.45, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 0.55 + strength * 0.25;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([4, 4]);
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 1.75, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawStatusRings(x: number, y: number, radius: number, statuses: NonNullable<EngineSnapshot['players'][number]['statuses']>): void {
    this.ctx.save();
    statuses.slice(0, 4).forEach((status, index) => {
      const ratio = status.durationTicks > 0 ? Math.max(0, Math.min(1, status.remainingTicks / status.durationTicks)) : 0;
      const ringRadius = radius * (1.95 + index * 0.26);
      this.ctx.globalAlpha = 0.48 + ratio * 0.32;
      this.ctx.strokeStyle = status.color;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.arc(x, y, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      this.ctx.stroke();
      if (status.stacks > 1) {
        this.ctx.fillStyle = status.color;
        this.ctx.font = '700 9px ui-monospace, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(String(status.stacks), x + ringRadius * 0.7, y - ringRadius * 0.7);
      }
    });
    this.ctx.restore();
  }

  private drawResourceBars(x: number, y: number, width: number, resources: NonNullable<EngineSnapshot['players'][number]['resources']>): void {
    if (resources.length === 0) {
      return;
    }
    const height = 3;
    this.ctx.save();
    resources.slice(0, 3).forEach((resource, index) => {
      const ratio = resource.max > 0 ? Math.max(0, Math.min(1, resource.value / resource.max)) : 0;
      const barY = y + index * 5;
      this.ctx.fillStyle = '#1b1b18';
      this.ctx.fillRect(x - width / 2, barY, width, height);
      this.ctx.fillStyle = resource.color;
      this.ctx.fillRect(x - width / 2, barY, width * ratio, height);
    });
    this.ctx.restore();
  }

  private drawLocalTelegraph(player: NonNullable<EngineSnapshot['players'][number]>, camera: CameraState): void {
    if (!this.ruleset) {
      return;
    }
    const slot = player.charging?.slot ?? player.lastUsedSlot;
    const ability = this.abilityForSlot(slot);
    if (!ability) {
      return;
    }
    const aim = normalized(player.charging?.aimDx ?? player.aimDx, player.charging?.aimDy ?? player.aimDy) ?? { x: 1, y: 0 };
    const ratio = player.charging?.ratio ?? 0;
    const range = ability.range * (ability.charge && player.charging ? lerp(ability.charge.rangeMultiplierMin ?? 1, ability.charge.rangeMultiplierMax ?? 1, ratio) : 1);
    const { x, y } = worldToViewport(camera, player.x, player.y);
    this.ctx.save();
    this.ctx.strokeStyle = ability.color;
    this.ctx.globalAlpha = player.charging ? 0.78 : 0.42;
    this.ctx.lineWidth = player.charging ? 3 : 2;
    this.ctx.setLineDash(player.charging ? [] : [8, 8]);
    this.ctx.beginPath();
    this.ctx.arc(x, y, range * camera.scale, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + aim.x * range * camera.scale, y + aim.y * range * camera.scale);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawChargeAura(x: number, y: number, radius: number, ratio: number, abilityId: string): void {
    const ability = this.ruleset?.abilities.find((candidate) => candidate.id === abilityId);
    const color = ability?.color ?? '#ffe66d';
    this.ctx.save();
    this.ctx.globalAlpha = 0.28 + ratio * 0.28;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * (1.8 + ratio * 1.2), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 0.95;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 2.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawObjectives(camera: CameraState): void {
    for (const objective of this.snapshot?.objectives ?? []) {
      if (objective.kind === 'deathmatch') {
        continue;
      }
      if (objective.kind === 'kingZone') {
        for (const zone of objective.zones) {
          const { x, y } = worldToViewport(camera, zone.x, zone.y);
          const controlled = !!objective.controllingTeamId;
          this.ctx.save();
          this.ctx.globalAlpha = controlled ? 0.22 : 0.1;
          this.ctx.fillStyle = zone.color;
          this.ctx.beginPath();
          this.ctx.arc(x, y, zone.radius * camera.scale, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.globalAlpha = controlled ? 0.85 : 0.48;
          this.ctx.strokeStyle = zone.color;
          this.ctx.lineWidth = controlled ? 3 : 2;
          this.ctx.setLineDash(controlled ? [] : [9, 6]);
          this.ctx.beginPath();
          this.ctx.arc(x, y, zone.radius * camera.scale, 0, Math.PI * 2);
          this.ctx.stroke();
          this.ctx.setLineDash([]);
          if (controlled && (objective.contestProgress ?? 0) > 0) {
            this.ctx.globalAlpha = 0.95;
            this.ctx.lineWidth = 4;
            this.ctx.beginPath();
            this.ctx.arc(
              x,
              y,
              zone.radius * camera.scale + 4,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * (objective.contestProgress ?? 0),
            );
            this.ctx.stroke();
          }
          this.ctx.restore();
        }
        continue;
      }
      for (const zone of objective.zones) {
        const { x, y } = worldToViewport(camera, zone.x, zone.y);
        const active = objective.activeZoneId === zone.zoneId;
        this.ctx.save();
        this.ctx.globalAlpha = active ? 0.2 : 0.1;
        this.ctx.fillStyle = zone.color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, zone.radius * camera.scale, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = active ? 0.82 : 0.48;
        this.ctx.strokeStyle = zone.color;
        this.ctx.lineWidth = active ? 3 : 2;
        this.ctx.setLineDash(active ? [] : [9, 6]);
        this.ctx.beginPath();
        this.ctx.arc(x, y, zone.radius * camera.scale, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        this.ctx.fillStyle = '#f5f3ed';
        this.ctx.font = '700 11px ui-monospace, monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${zone.team} +${zone.points}`, x, y + 4);
        this.ctx.restore();
      }
      const { x: relicX, y: relicY } = worldToViewport(camera, objective.x, objective.y);
      this.ctx.save();
      this.ctx.strokeStyle = objective.color;
      this.ctx.globalAlpha = objective.scoreCooldownTicks > 0 ? 0.35 : 0.72;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(relicX, relicY, Math.max(7, objective.radius * camera.scale * 1.55), 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawConstraints(camera: CameraState): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return;
    }
    for (const constraint of snapshot.constraints) {
      const target = snapshot.players.find((player) => player.playerId === constraint.targetId);
      if (!target) {
        continue;
      }
      const anchorBody = constraint.anchorBodyId
        ? snapshot.physicsBodies.find((body) => body.bodyId === constraint.anchorBodyId)
        : undefined;
      const targetPoint = worldToViewport(camera, target.x, target.y);
      const anchorPoint = worldToViewport(camera, anchorBody?.x ?? constraint.anchorX, anchorBody?.y ?? constraint.anchorY);
      const fade = Math.max(0.28, Math.min(1, constraint.remainingTicks / 40));
      this.ctx.save();
      this.ctx.globalAlpha = fade;
      this.ctx.strokeStyle = constraint.color;
      this.ctx.lineWidth = constraint.kind === 'drag' ? 3 : 2;
      this.ctx.setLineDash(constraint.kind === 'drag' ? [8, 5] : [4, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(targetPoint.x, targetPoint.y);
      this.ctx.lineTo(anchorPoint.x, anchorPoint.y);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
      this.ctx.globalAlpha = fade * 0.65;
      this.ctx.beginPath();
      this.ctx.arc(anchorPoint.x, anchorPoint.y, Math.max(5, constraint.length * camera.scale), 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.globalAlpha = fade;
      this.ctx.fillStyle = constraint.color;
      this.ctx.beginPath();
      this.ctx.arc(anchorPoint.x, anchorPoint.y, 4.5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  private drawPhysicsBodies(camera: CameraState): void {
    for (const body of this.snapshot?.physicsBodies ?? []) {
      const { x, y } = worldToViewport(camera, body.x, body.y);
      const radius = Math.max(5, body.radius * camera.scale);
      const fade = Math.max(0.25, Math.min(1, body.remainingTicks / 30));
      this.ctx.save();
      this.ctx.globalAlpha = fade;
      this.ctx.shadowColor = body.color;
      this.ctx.shadowBlur = 10;
      this.ctx.fillStyle = body.color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = '#f5f3ed';
      this.ctx.globalAlpha = Math.min(1, fade + 0.25);
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > 0.05) {
        this.ctx.strokeStyle = body.color;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 0.55 * fade;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x - body.vx * camera.scale * 0.35, y - body.vy * camera.scale * 0.35);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }
  }

  private drawDeathLabel(player: NonNullable<EngineSnapshot['players'][number]>, x: number, y: number, radius: number): void {
    const remainingTicks = Math.max(0, player.respawnTick - (this.snapshot?.tick ?? 0));
    const seconds = this.ruleset ? Math.ceil(remainingTicks / this.ruleset.tickRate) : remainingTicks;
    this.ctx.save();
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '800 14px ui-sans-serif, system-ui';
    this.ctx.fillText('KO', x, y + 5);
    this.ctx.fillStyle = '#b9b4a8';
    this.ctx.font = '11px ui-monospace, monospace';
    this.ctx.fillText(`${seconds}s`, x, y + radius + 22);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.globalAlpha = 0.5;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private abilityForSlot(slot: number): Ruleset['abilities'][number] | undefined {
    if (!this.ruleset || !Number.isInteger(slot) || slot < 0 || slot >= this.ruleset.loadout.abilityIds.length) {
      return undefined;
    }
    const abilityId = this.ruleset.loadout.abilityIds[slot];
    return this.ruleset.abilities.find((ability) => ability.id === abilityId);
  }

  private cameraForCurrentViewport(): CameraState | undefined {
    if (!this.ruleset) {
      return undefined;
    }
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      return undefined;
    }
    return this.cameraForFrame(width, height);
  }

  private cameraForFrame(width: number, height: number): CameraState {
    if (!this.ruleset) {
      throw new Error('camera unavailable without ruleset');
    }
    return createCameraState(this.ruleset, width, height, this.cameraTarget(), this.cameraZoom);
  }

  private cameraTarget(): Vec2 | undefined {
    return this.snapshot?.players.find((player) => player.playerId === this.localPlayerId && player.alive);
  }

  private drawGrid(camera: CameraState, width: number, height: number): void {
    this.ctx.strokeStyle = '#242421';
    this.ctx.lineWidth = 1;
    const step = camera.scale * 2;
    for (let x = camera.originX % step; x < width; x += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    for (let y = camera.originY % step; y < height; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }
  }

  private drawArena(camera: CameraState): void {
    if (!this.ruleset) {
      return;
    }
    const { x, y } = worldToViewport(camera, -this.ruleset.arena.width / 2, -this.ruleset.arena.height / 2);
    this.ctx.strokeStyle = '#2fd17c';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, this.ruleset.arena.width * camera.scale, this.ruleset.arena.height * camera.scale);
  }

  private drawCentered(text: string): void {
    this.ctx.font = '16px ui-sans-serif, system-ui';
    this.ctx.fillStyle = '#b9b4a8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
  }
}

function normalized(x: number, y: number): { x: number; y: number } | undefined {
  const mag = Math.hypot(x, y);
  if (mag < 0.001) {
    return undefined;
  }
  return { x: x / mag, y: y / mag };
}

function lerp(min: number, max: number, ratio: number): number {
  return min + (max - min) * Math.max(0, Math.min(1, ratio));
}

function actorFill(hue: number, role: EngineSnapshot['players'][number]['role']): string {
  if (role === 'dummy') {
    return `hsl(${hue} 52% 48%)`;
  }
  if (role === 'npc') {
    return `hsl(${hue} 72% 50%)`;
  }
  return `hsl(${hue} 76% 58%)`;
}

function actorStroke(role: EngineSnapshot['players'][number]['role'], alive: boolean): string {
  if (!alive) {
    return '#252521';
  }
  if (role === 'dummy') {
    return '#ffe66d';
  }
  if (role === 'npc') {
    return '#ff6b4a';
  }
  return '#0a0a0a';
}
