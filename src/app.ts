import { createDefaultRuleset } from './engine/defaultRules';
import { EngineClient } from './engine/EngineClient';
import { hashRuleset } from './engine/rulesHash';
import { parseRulesetJson, stringifyRuleset, validateRuleset } from './engine/rulesValidation';
import type { EngineSnapshot, PlayerInput, Ruleset } from './engine/protocol';
import { InputController, type TouchControlElements } from './input/InputController';
import { HostSession, ClientSession } from './net/webrtc';
import { CanvasRenderer } from './render/CanvasRenderer';
import type { RoomInfo } from './rooms/directory';
import { createRoomDirectory } from './rooms/directoryFactory';
import { createId } from './utils/ids';
import { shortHash } from './utils/hash';

type Mode = 'idle' | 'solo' | 'host' | 'client';

export class BeatApp {
  private readonly directoryRuntime = createRoomDirectory();
  private readonly directory = this.directoryRuntime.directory;
  private readonly peerId = createId('peer');
  private readonly handleFullscreenChange = () => this.syncFullscreenButton();
  private readonly beforeUnloadHandler = () => {
    this.hostSession?.destroy();
  };
  private readonly renderer: CanvasRenderer;
  private readonly input: InputController;
  private readonly root: HTMLElement;
  private mode: Mode = 'idle';
  private displayNameInput!: HTMLInputElement;
  private roomNameInput!: HTMLInputElement;
  private hostButton!: HTMLButtonElement;
  private soloButton!: HTMLButtonElement;
  private leaveButton!: HTMLButtonElement;
  private roomList!: HTMLDivElement;
  private statusLine!: HTMLDivElement;
  private menuStatusLine!: HTMLDivElement;
  private hashLine!: HTMLDivElement;
  private rulesHashLine!: HTMLDivElement;
  private peerLine!: HTMLDivElement;
  private logRoot!: HTMLDivElement;
  private menuView!: HTMLElement;
  private arenaView!: HTMLElement;
  private rulesJsonInput!: HTMLTextAreaElement;
  private resetRulesButton!: HTMLButtonElement;
  private applyRulesButton!: HTMLButtonElement;
  private copyRulesButton!: HTMLButtonElement;
  private skillButtons!: HTMLButtonElement[];
  private canvas!: HTMLCanvasElement;
  private fullscreenButton!: HTMLButtonElement;
  private engine?: EngineClient;
  private hostSession?: HostSession;
  private clientSession?: ClientSession;
  private localPlayerId?: string;
  private ruleset?: Ruleset;
  private unsubscribeRooms?: () => void;
  private unsubscribeInput?: () => void;
  private unsubscribeSnapshot?: () => void;
  private lastSnapshot?: EngineSnapshot;
  private editableRuleset: Ruleset = createDefaultRuleset();
  private editableRulesetHash = '';

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = shellHtml();
    this.bindDom();
    this.renderer = new CanvasRenderer(this.canvas);
    this.input = new InputController(this.canvas, this.touchControls());
  }

  start(): void {
    this.renderer.start();
    this.input.start();
    this.unsubscribeInput = this.input.onInput((input) => this.handleInput(input));
    this.unsubscribeRooms = this.directory.subscribeRooms((rooms) => this.renderRooms(rooms));
    this.hostButton.addEventListener('click', () => void this.hostRoom());
    this.soloButton.addEventListener('click', () => void this.startSolo());
    this.leaveButton.addEventListener('click', () => this.stopActiveMode());
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    this.resetRulesButton.addEventListener('click', () => void this.resetRules());
    this.applyRulesButton.addEventListener('click', () => void this.applyRulesJson());
    this.copyRulesButton.addEventListener('click', () => void this.copyRulesJson());
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.rulesJsonInput.value = stringifyRuleset(this.editableRuleset);
    void this.refreshRulesHash();
    this.syncFullscreenButton();
    this.showMenu();
    this.setStatus('idle: local directory ready');
    this.hashLine.textContent = this.directoryRuntime.label;
    this.peerLine.textContent = `peer ${shortHash(this.peerId)}`;
  }

  destroy(): void {
    this.stopActiveMode();
    this.unsubscribeRooms?.();
    this.unsubscribeInput?.();
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    this.input.destroy();
    this.renderer.destroy();
    this.directory.destroy();
  }

  private bindDom(): void {
    this.menuView = requireNode<HTMLElement>('#menu-view');
    this.arenaView = requireNode<HTMLElement>('#arena-view');
    this.displayNameInput = requireNode<HTMLInputElement>('#display-name');
    this.roomNameInput = requireNode<HTMLInputElement>('#room-name');
    this.hostButton = requireNode<HTMLButtonElement>('#host-room');
    this.soloButton = requireNode<HTMLButtonElement>('#solo-room');
    this.leaveButton = requireNode<HTMLButtonElement>('#leave-room');
    this.roomList = requireNode<HTMLDivElement>('#room-list');
    this.statusLine = requireNode<HTMLDivElement>('#status-line');
    this.menuStatusLine = requireNode<HTMLDivElement>('#menu-status-line');
    this.hashLine = requireNode<HTMLDivElement>('#hash-line');
    this.rulesHashLine = requireNode<HTMLDivElement>('#rules-hash-line');
    this.peerLine = requireNode<HTMLDivElement>('#peer-line');
    this.logRoot = requireNode<HTMLDivElement>('#log');
    this.rulesJsonInput = requireNode<HTMLTextAreaElement>('#rules-json');
    this.fullscreenButton = requireNode<HTMLButtonElement>('#fullscreen-toggle');
    this.resetRulesButton = requireNode<HTMLButtonElement>('#reset-rules');
    this.applyRulesButton = requireNode<HTMLButtonElement>('#apply-rules');
    this.copyRulesButton = requireNode<HTMLButtonElement>('#copy-rules');
    this.skillButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.skill-slot'));
    if (this.skillButtons.length !== 4) {
      throw new Error('missing skill slots');
    }
    this.canvas = requireNode<HTMLCanvasElement>('#arena');
  }

  private async hostRoom(): Promise<void> {
    const selectedRuleset = this.readRulesForStart();
    if (!selectedRuleset) {
      return;
    }
    this.stopActiveMode();
    this.mode = 'host';
    this.ruleset = selectedRuleset;
    const rulesetHash = await hashRuleset(this.ruleset);
    const hostPlayerId = createId('player');
    this.localPlayerId = hostPlayerId;
    this.renderer.setRuleset(this.ruleset);
    this.renderer.setEmptyMessage('No room active');
    this.renderer.setLocalPlayer(hostPlayerId);
    this.showArena();

    this.engine = new EngineClient();
    this.engine.onNotice((message) => this.log(message));
    await this.engine.init(this.ruleset);
    this.engine.addPlayer({
      playerId: hostPlayerId,
      displayName: this.displayName(),
      hue: 150,
      local: true,
    });
    this.unsubscribeSnapshot = this.engine.onSnapshot((snapshot) => {
      this.lastSnapshot = snapshot;
      window.__BEAT_SNAPSHOT__ = snapshot;
      this.renderer.update(snapshot);
      this.updateAimOrigin(snapshot);
      this.updateSkillBar(snapshot);
      this.hostSession?.broadcastSnapshot(snapshot);
      this.setStatus(`hosting: ${room.name}`);
    });

    const room: RoomInfo = {
      roomId: createId('room'),
      hostPeerId: this.peerId,
      name: this.roomNameInput.value.trim() || `${this.displayName()}'s room`,
      rulesetId: this.ruleset.id,
      rulesetHash,
      contentHash: this.ruleset.contentHash,
      mapBundleId: this.ruleset.mapBundleId,
      playerCount: 1,
      maxPlayers: this.ruleset.maxPlayers,
      transport: 'webrtc',
      status: 'open',
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.hostSession = new HostSession({
      directory: this.directory,
      engine: this.engine,
      room,
      ruleset: this.ruleset,
      hostPeerId: this.peerId,
    });
    this.hostSession.onLog((message) => this.log(message));
    await this.hostSession.start();
    this.hashLine.textContent = `rules ${shortHash(rulesetHash)} · content ${shortHash(this.ruleset.contentHash)}`;
    this.setStatus(`hosting: ${room.name}`);
    this.log(`room open: ${room.roomId}`);
  }

  private async startSolo(): Promise<void> {
    const selectedRuleset = this.readRulesForStart();
    if (!selectedRuleset) {
      return;
    }
    this.stopActiveMode();
    this.mode = 'solo';
    this.ruleset = selectedRuleset;
    const rulesetHash = await hashRuleset(this.ruleset);
    const playerId = createId('player');
    this.localPlayerId = playerId;
    this.renderer.setRuleset(this.ruleset);
    this.renderer.setEmptyMessage('No room active');
    this.renderer.setLocalPlayer(playerId);
    this.showArena();
    this.engine = new EngineClient();
    this.engine.onNotice((message) => this.log(message));
    await this.engine.init(this.ruleset);
    this.engine.addPlayer({
      playerId,
      displayName: this.displayName(),
      hue: 150,
      local: true,
    });
    this.unsubscribeSnapshot = this.engine.onSnapshot((snapshot) => {
      this.lastSnapshot = snapshot;
      window.__BEAT_SNAPSHOT__ = snapshot;
      this.renderer.update(snapshot);
      this.updateAimOrigin(snapshot);
      this.updateSkillBar(snapshot);
      this.setStatus('solo: browser worker authority');
    });
    this.hashLine.textContent = `rules ${shortHash(rulesetHash)} · content ${shortHash(this.ruleset.contentHash)}`;
    this.setStatus('solo: browser worker authority');
  }

  private async joinRoom(room: RoomInfo): Promise<void> {
    this.stopActiveMode();
    this.mode = 'client';
    this.localPlayerId = undefined;
    this.renderer.setRuleset(undefined);
    this.renderer.setEmptyMessage(`Joining ${room.name}...`);
    this.showArena();
    this.clientSession = new ClientSession({
      directory: this.directory,
      peerId: this.peerId,
      displayName: this.displayName(),
    });
    this.clientSession.onLog((message) => this.log(message));
    this.clientSession.onDisconnect(() => {
      this.log('host disconnected');
      this.stopActiveMode();
    });
    this.clientSession.onWelcome((playerId, joinedRoom, ruleset) => {
      this.localPlayerId = playerId;
      this.ruleset = ruleset;
      this.renderer.setRuleset(ruleset);
      this.renderer.setEmptyMessage('No room active');
      this.renderer.setLocalPlayer(playerId);
      this.hashLine.textContent = `rules ${shortHash(joinedRoom.rulesetHash)} · content ${shortHash(joinedRoom.contentHash)}`;
      this.setStatus(`joined: ${joinedRoom.name}`);
    });
    this.clientSession.onSnapshot((snapshot) => {
      this.lastSnapshot = snapshot;
      window.__BEAT_SNAPSHOT__ = snapshot;
      this.renderer.update(snapshot);
      this.updateAimOrigin(snapshot);
      this.updateSkillBar(snapshot);
      this.setStatus(`joined: ${room.name}`);
    });
    await this.clientSession.connect(room);
    this.setStatus(`joining: ${room.name}`);
  }

  private handleInput(input: PlayerInput): void {
    if (!this.localPlayerId) {
      return;
    }
    if (this.mode === 'host' || this.mode === 'solo') {
      this.engine?.submitInput(this.localPlayerId, input);
      return;
    }
    if (this.mode === 'client') {
      this.clientSession?.submitInput(input);
    }
  }

  private stopActiveMode(): void {
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = undefined;
    this.hostSession?.destroy();
    this.hostSession = undefined;
    this.clientSession?.destroy();
    this.clientSession = undefined;
    this.engine?.destroy();
    this.engine = undefined;
    this.localPlayerId = undefined;
    this.ruleset = undefined;
    this.lastSnapshot = undefined;
    window.__BEAT_SNAPSHOT__ = undefined;
    this.renderer.setRuleset(undefined);
    this.renderer.setEmptyMessage('No room active');
    this.renderer.setLocalPlayer(undefined);
    this.input.setAimOrigin(undefined);
    this.updateSkillBar(undefined);
    this.mode = 'idle';
    this.setRulesLocked(false);
    void this.exitFullscreen();
    this.showMenu();
    this.setStatus(`idle: ${this.directoryRuntime.label}`);
  }

  private renderRooms(rooms: RoomInfo[]): void {
    this.roomList.innerHTML = '';
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'room-empty';
      empty.textContent = 'No hosted rooms visible on this origin.';
      this.roomList.append(empty);
      return;
    }
    for (const room of rooms) {
      const row = document.createElement('button');
      row.className = 'room-row';
      row.type = 'button';
      row.innerHTML = `
        <span class="room-row__name">${escapeHtml(room.name)}</span>
        <span class="room-row__meta">${room.playerCount}/${room.maxPlayers} · ${shortHash(room.rulesetHash)}</span>
      `;
      row.addEventListener('click', () => void this.joinRoom(room));
      this.roomList.append(row);
    }
  }

  private displayName(): string {
    return this.displayNameInput.value.trim() || 'Player';
  }

  private setStatus(status: string): void {
    const playerCount = this.lastSnapshot?.players.length ?? 0;
    const text = `${status} · players ${playerCount}`;
    this.statusLine.textContent = text;
    this.menuStatusLine.textContent = text;
  }

  private log(message: string): void {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    this.logRoot.prepend(line);
    while (this.logRoot.children.length > 12) {
      this.logRoot.lastElementChild?.remove();
    }
  }

  private currentRuleset(): Ruleset {
    this.editableRuleset = parseRulesetJson(this.rulesJsonInput.value);
    this.rulesJsonInput.value = stringifyRuleset(this.editableRuleset);
    void this.refreshRulesHash();
    return this.editableRuleset;
  }

  private readRulesForStart(): Ruleset | undefined {
    try {
      return this.currentRuleset();
    } catch (error) {
      this.log(`rules rejected: ${readError(error)}`);
      return undefined;
    }
  }

  private async resetRules(): Promise<void> {
    this.editableRuleset = createDefaultRuleset();
    this.rulesJsonInput.value = stringifyRuleset(this.editableRuleset);
    await this.refreshRulesHash();
    this.log('rules reset to default preset');
  }

  private async applyRulesJson(): Promise<void> {
    try {
      this.editableRuleset = validateRuleset(parseRulesetJson(this.rulesJsonInput.value));
      this.rulesJsonInput.value = stringifyRuleset(this.editableRuleset);
      await this.refreshRulesHash();
      this.log(`rules applied: ${this.editableRuleset.name}`);
    } catch (error) {
      this.log(`rules rejected: ${readError(error)}`);
    }
  }

  private async copyRulesJson(): Promise<void> {
    const json = stringifyRuleset(parseRulesetJson(this.rulesJsonInput.value));
    this.rulesJsonInput.value = json;
    await navigator.clipboard?.writeText(json).catch(() => undefined);
    this.log('rules JSON ready to export');
  }

  private async refreshRulesHash(): Promise<void> {
    this.editableRulesetHash = await hashRuleset(parseRulesetJson(this.rulesJsonInput.value));
    this.rulesHashLine.textContent = `${this.editableRuleset.name} · ${shortHash(this.editableRulesetHash)}`;
  }

  private showMenu(): void {
    this.menuView.hidden = false;
    this.arenaView.hidden = true;
  }

  private showArena(): void {
    this.menuView.hidden = true;
    this.arenaView.hidden = false;
    this.syncFullscreenButton();
    requestAnimationFrame(() => this.renderer.resizeNow());
    this.setRulesLocked(true);
    this.updateSkillBar(this.lastSnapshot);
  }

  private canFullscreen(): boolean {
    return typeof this.arenaView.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  }

  private syncFullscreenButton(): void {
    const active = document.fullscreenElement === this.arenaView;
    this.fullscreenButton.disabled = !this.canFullscreen();
    this.fullscreenButton.textContent = active ? 'Window' : 'Fullscreen';
    this.fullscreenButton.setAttribute('aria-pressed', String(active));
    this.fullscreenButton.title = this.canFullscreen() ? (active ? 'Exit fullscreen' : 'Enter fullscreen') : 'Fullscreen is unavailable in this browser';
  }

  private async toggleFullscreen(): Promise<void> {
    if (!this.canFullscreen()) {
      return;
    }
    try {
      if (document.fullscreenElement === this.arenaView) {
        await document.exitFullscreen();
        return;
      }
      await this.arenaView.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      this.log(`fullscreen unavailable: ${readError(error)}`);
    } finally {
      this.syncFullscreenButton();
    }
  }

  private async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement !== this.arenaView) {
      this.syncFullscreenButton();
      return;
    }
    await document.exitFullscreen().catch(() => undefined);
    this.syncFullscreenButton();
  }

  private setRulesLocked(locked: boolean): void {
    this.rulesJsonInput.disabled = locked;
    this.resetRulesButton.disabled = locked;
    this.applyRulesButton.disabled = locked;
    this.copyRulesButton.disabled = locked;
  }

  private updateAimOrigin(snapshot: EngineSnapshot): void {
    if (!this.localPlayerId) {
      this.input.setAimOrigin(undefined);
      return;
    }
    const local = snapshot.players.find((player) => player.playerId === this.localPlayerId);
    this.input.setAimOrigin(local ? this.renderer.worldToClient(local.x, local.y) : undefined);
  }

  private updateSkillBar(snapshot: EngineSnapshot | undefined): void {
    const ruleset = this.ruleset;
    const local = this.localPlayerId ? snapshot?.players.find((player) => player.playerId === this.localPlayerId) : undefined;
    for (const [index, button] of this.skillButtons.entries()) {
      const abilityId = ruleset?.loadout.abilityIds[index];
      const ability = abilityId ? ruleset?.abilities.find((candidate) => candidate.id === abilityId) : undefined;
      const cooldown = local?.slotCooldownTicks[index] ?? 0;
      const ratio = ability && ability.cooldownTicks > 0 ? Math.max(0, Math.min(1, cooldown / ability.cooldownTicks)) : 0;
      button.style.setProperty('--skill-color', ability?.color ?? '#6a6760');
      button.style.setProperty('--cooldown-ratio', String(ratio));
      button.classList.toggle('is-cooling', cooldown > 0);
      button.classList.toggle('is-unavailable', !ability || Boolean(local && !local.alive));
      button.disabled = !ability || Boolean(local && !local.alive);
      button.title = ability ? `${index + 1} ${ability.name}` : `Slot ${index + 1}`;
      button.setAttribute('aria-label', ability ? `Slot ${index + 1}: ${ability.name}` : `Slot ${index + 1}`);
      button.querySelector('.skill-slot__name')?.replaceChildren(document.createTextNode(ability?.name ?? `Slot ${index + 1}`));
      button.querySelector('.skill-slot__timer')?.replaceChildren(document.createTextNode(cooldown > 0 ? String(cooldown) : ''));
    }
  }

  private touchControls(): TouchControlElements {
    return {
      root: requireNode<HTMLElement>('#touch-controls'),
      joystick: requireNode<HTMLElement>('#touch-joystick'),
      joystickKnob: requireNode<HTMLElement>('#touch-joystick-knob'),
      firePad: requireNode<HTMLElement>('#touch-fire'),
      fireKnob: requireNode<HTMLElement>('#touch-fire-knob'),
      skillButtons: this.skillButtons,
    };
  }
}

function shellHtml(): string {
  return `
    <main class="app-shell">
      <section id="menu-view" class="menu-view">
        <div class="brand">
          <div class="brand__mark"></div>
          <div>
            <h1>Beat</h1>
            <p>PWA hosted hackable arena rooms</p>
          </div>
        </div>
        <div class="menu-grid">
          <section class="menu-section">
            <h2>Lobby</h2>
            <label class="field">
              <span>Name</span>
              <input id="display-name" value="Player" autocomplete="off" maxlength="24" />
            </label>
            <label class="field">
              <span>Room</span>
              <input id="room-name" value="Beat room" autocomplete="off" maxlength="36" />
            </label>
            <div class="button-grid">
              <button id="host-room" class="button button--primary" type="button">Host</button>
              <button id="solo-room" class="button" type="button">Solo</button>
            </div>
            <div id="menu-status-line" class="menu-status">starting</div>
            <section class="room-section">
              <h2>Rooms</h2>
              <div id="room-list" class="room-list"></div>
            </section>
          </section>
          <section class="menu-section menu-section--rules">
            <h2>Rules JSON</h2>
            <div id="rules-hash-line" class="rules-hash">rules hash</div>
            <textarea id="rules-json" class="rules-json" spellcheck="false"></textarea>
            <div class="button-grid button-grid--rules">
              <button id="apply-rules" class="button button--primary" type="button">Apply</button>
              <button id="copy-rules" class="button" type="button">Copy</button>
              <button id="reset-rules" class="button button--danger" type="button">Reset</button>
            </div>
          </section>
        </div>
      </section>

      <section id="arena-view" class="arena-view" hidden>
        <canvas id="arena" class="arena" aria-label="Beat arena"></canvas>
        <div class="hud">
          <div id="status-line">starting</div>
          <div id="hash-line">rules idle</div>
          <div id="peer-line">peer</div>
        </div>
        <div class="arena-actions">
          <button id="fullscreen-toggle" class="button arena-action-button" type="button" aria-pressed="false">Fullscreen</button>
          <button id="leave-room" class="button arena-action-button" type="button">Menu</button>
        </div>
        <div id="skill-bar" class="skill-bar" aria-label="Skill bar">
          <button class="skill-slot" type="button" data-slot="0">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__key">1</span>
            <span class="skill-slot__name">Slot 1</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="1">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__key">2</span>
            <span class="skill-slot__name">Slot 2</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="2">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__key">3</span>
            <span class="skill-slot__name">Slot 3</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="3">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__key">4</span>
            <span class="skill-slot__name">Slot 4</span>
            <span class="skill-slot__timer"></span>
          </button>
        </div>
        <div id="touch-controls" class="touch-controls" aria-hidden="true">
          <div id="touch-joystick" class="touch-pad touch-pad--move">
            <div id="touch-joystick-knob" class="touch-knob"></div>
          </div>
          <div id="touch-fire" class="touch-pad touch-pad--fire">
            <div id="touch-fire-knob" class="touch-knob"></div>
          </div>
        </div>
        <details class="arena-log">
          <summary>Log</summary>
          <div id="log" class="log"></div>
        </details>
      </section>
    </main>
  `;
}

function requireNode<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`missing ${selector}`);
  }
  return node;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#039;';
    }
  });
}
