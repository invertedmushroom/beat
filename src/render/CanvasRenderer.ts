import type { EngineSnapshot, Ruleset } from '../engine/protocol';

export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private snapshot?: EngineSnapshot;
  private ruleset?: Ruleset;
  private frame?: number;
  private localPlayerId?: string;
  private emptyMessage = 'No room active';

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

  resizeNow(): void {
    this.resize();
  }

  worldToClient(x: number, y: number): { x: number; y: number } | undefined {
    if (!this.ruleset) {
      return undefined;
    }
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / (this.ruleset.arena.width + 4), rect.height / (this.ruleset.arena.height + 4));
    return {
      x: rect.left + rect.width / 2 + x * scale,
      y: rect.top + rect.height / 2 + y * scale,
    };
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
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = '#141414';
    this.ctx.fillRect(0, 0, width, height);

    if (!this.ruleset) {
      this.drawCentered(this.emptyMessage);
      return;
    }

    const scale = Math.min(width / (this.ruleset.arena.width + 4), height / (this.ruleset.arena.height + 4));
    const originX = width / 2;
    const originY = height / 2;

    this.drawGrid(originX, originY, scale, width, height);
    this.drawArena(originX, originY, scale);

    for (const obstacle of this.ruleset.obstacles) {
      const x = originX + (obstacle.x - obstacle.halfWidth) * scale;
      const y = originY + (obstacle.y - obstacle.halfHeight) * scale;
      this.ctx.fillStyle = '#30302d';
      this.ctx.strokeStyle = '#5d5a4f';
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(x, y, obstacle.halfWidth * 2 * scale, obstacle.halfHeight * 2 * scale);
      this.ctx.strokeRect(x, y, obstacle.halfWidth * 2 * scale, obstacle.halfHeight * 2 * scale);
    }

    for (const effect of this.snapshot?.effects ?? []) {
      const x = originX + effect.x * scale;
      const y = originY + effect.y * scale;
      const progress = effect.lifetimeTicks > 0 ? effect.ageTicks / effect.lifetimeTicks : 1;
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, 1 - progress);
      this.ctx.beginPath();
      this.ctx.strokeStyle = effect.color;
      this.ctx.lineWidth = effect.kind === 'melee' ? 2 : 3;
      this.ctx.arc(x, y, effect.radius * scale * (0.7 + progress * 0.55), 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }

    for (const projectile of this.snapshot?.projectiles ?? []) {
      const x = originX + projectile.x * scale;
      const y = originY + projectile.y * scale;
      this.ctx.beginPath();
      this.ctx.fillStyle = projectile.color;
      this.ctx.shadowColor = projectile.color;
      this.ctx.shadowBlur = 12;
      this.ctx.arc(x, y, Math.max(3, projectile.radius * scale), 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }

    for (const player of this.snapshot?.players ?? []) {
      const x = originX + player.x * scale;
      const y = originY + player.y * scale;
      const radius = this.ruleset.player.radius * scale;
      this.ctx.beginPath();
      this.ctx.fillStyle = player.alive ? `hsl(${player.hue} 76% 58%)` : '#55524a';
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.lineWidth = player.playerId === this.localPlayerId ? 3 : 1.5;
      this.ctx.strokeStyle = player.playerId === this.localPlayerId ? '#ffe66d' : player.alive ? '#0a0a0a' : '#252521';
      this.ctx.stroke();

      this.ctx.font = '12px ui-sans-serif, system-ui';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#f5f3ed';
      this.ctx.fillText(player.displayName, x, y - radius - 9);
      this.drawHpBar(x, y + radius + 9, radius * 2.6, player.hp, player.maxHp, player.alive);
      if (!player.alive) {
        this.ctx.fillStyle = '#b9b4a8';
        this.ctx.fillText('respawn', x, y + 4);
      }
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

  private drawGrid(originX: number, originY: number, scale: number, width: number, height: number): void {
    this.ctx.strokeStyle = '#242421';
    this.ctx.lineWidth = 1;
    const step = scale * 2;
    for (let x = originX % step; x < width; x += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    for (let y = originY % step; y < height; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }
  }

  private drawArena(originX: number, originY: number, scale: number): void {
    if (!this.ruleset) {
      return;
    }
    const x = originX - (this.ruleset.arena.width / 2) * scale;
    const y = originY - (this.ruleset.arena.height / 2) * scale;
    this.ctx.strokeStyle = '#2fd17c';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, this.ruleset.arena.width * scale, this.ruleset.arena.height * scale);
  }

  private drawCentered(text: string): void {
    this.ctx.font = '16px ui-sans-serif, system-ui';
    this.ctx.fillStyle = '#b9b4a8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
  }
}
