import { createDefaultRuleset } from './engine/defaultRules';
import { EngineClient } from './engine/EngineClient';
import { hashRuleset } from './engine/rulesHash';
import { parseRulesetJson, stringifyRuleset, validateRuleset } from './engine/rulesValidation';
import type {
  AiTraceSnapshot,
  EngineSnapshot,
  MechanicAction,
  MechanicCondition,
  MechanicTraceSnapshot,
  NpcArchetype,
  NpcSpawn,
  PlayerInput,
  Ruleset,
  RuntimeNpcConfig,
} from './engine/protocol';
import { InputController, type TouchControlElements } from './input/InputController';
import { HostSession, ClientSession } from './net/webrtc';
import { CanvasRenderer } from './render/CanvasRenderer';
import type { RoomInfo } from './rooms/directory';
import { createRoomDirectory } from './rooms/directoryFactory';
import { createId } from './utils/ids';
import { shortHash } from './utils/hash';

type Mode = 'idle' | 'solo' | 'lab' | 'host' | 'client';

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
  private labButton!: HTMLButtonElement;
  private leaveButton!: HTMLButtonElement;
  private roomList!: HTMLDivElement;
  private statusLine!: HTMLDivElement;
  private menuStatusLine!: HTMLDivElement;
  private hashLine!: HTMLDivElement;
  private rulesHashLine!: HTMLDivElement;
  private peerLine!: HTMLDivElement;
  private localMechanicsRoot!: HTMLDivElement;
  private traceRoot!: HTMLDivElement;
  private logRoot!: HTMLDivElement;
  private labControlsRoot!: HTMLDivElement;
  private labSpawnSelect!: HTMLSelectElement;
  private labSpawnButton!: HTMLButtonElement;
  private labClearActorsButton!: HTMLButtonElement;
  private labResetButton!: HTMLButtonElement;
  private labClearTraceButton!: HTMLButtonElement;
  private labPauseButton!: HTMLButtonElement;
  private menuView!: HTMLElement;
  private arenaView!: HTMLElement;
  private rulesJsonInput!: HTMLTextAreaElement;
  private rulesValidationLine!: HTMLDivElement;
  private rulesInspector!: HTMLDivElement;
  private resetRulesButton!: HTMLButtonElement;
  private applyRulesButton!: HTMLButtonElement;
  private copyRulesButton!: HTMLButtonElement;
  private rulesExampleButtons!: HTMLButtonElement[];
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
  private previousSlotCooldowns?: number[];
  private editableRuleset: Ruleset = createDefaultRuleset();
  private editableRulesetHash = '';
  private rulesInspectorRefreshId = 0;
  private labActorIds = new Set<string>();
  private labSpawnIndex = 0;
  private labPaused = false;

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
    this.soloButton.addEventListener('click', () => void this.startSolo(false));
    this.labButton.addEventListener('click', () => void this.startSolo(true));
    this.leaveButton.addEventListener('click', () => this.stopActiveMode());
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen());
    this.labSpawnButton.addEventListener('click', () => this.spawnSelectedLabActor());
    this.labClearActorsButton.addEventListener('click', () => this.clearLabActors());
    this.labResetButton.addEventListener('click', () => this.resetLabActors());
    this.labClearTraceButton.addEventListener('click', () => this.clearLabTrace());
    this.labPauseButton.addEventListener('click', () => this.toggleLabPause());
    this.resetRulesButton.addEventListener('click', () => void this.resetRules());
    this.applyRulesButton.addEventListener('click', () => void this.applyRulesJson());
    this.copyRulesButton.addEventListener('click', () => void this.copyRulesJson());
    this.rulesJsonInput.addEventListener('input', () => void this.refreshRulesInspector());
    for (const button of this.rulesExampleButtons) {
      button.addEventListener('click', () => void this.insertRulesExample(button.dataset.example ?? ''));
    }
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.rulesJsonInput.value = stringifyRuleset(this.editableRuleset);
    void this.refreshRulesInspector();
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
    this.labButton = requireNode<HTMLButtonElement>('#lab-room');
    this.leaveButton = requireNode<HTMLButtonElement>('#leave-room');
    this.roomList = requireNode<HTMLDivElement>('#room-list');
    this.statusLine = requireNode<HTMLDivElement>('#status-line');
    this.menuStatusLine = requireNode<HTMLDivElement>('#menu-status-line');
    this.hashLine = requireNode<HTMLDivElement>('#hash-line');
    this.rulesHashLine = requireNode<HTMLDivElement>('#rules-hash-line');
    this.peerLine = requireNode<HTMLDivElement>('#peer-line');
    this.localMechanicsRoot = requireNode<HTMLDivElement>('#local-mechanics');
    this.traceRoot = requireNode<HTMLDivElement>('#trace-log');
    this.logRoot = requireNode<HTMLDivElement>('#log');
    this.labControlsRoot = requireNode<HTMLDivElement>('#lab-controls');
    this.labSpawnSelect = requireNode<HTMLSelectElement>('#lab-spawn-select');
    this.labSpawnButton = requireNode<HTMLButtonElement>('#lab-spawn');
    this.labClearActorsButton = requireNode<HTMLButtonElement>('#lab-clear-actors');
    this.labResetButton = requireNode<HTMLButtonElement>('#lab-reset');
    this.labClearTraceButton = requireNode<HTMLButtonElement>('#lab-clear-trace');
    this.labPauseButton = requireNode<HTMLButtonElement>('#lab-pause');
    this.rulesJsonInput = requireNode<HTMLTextAreaElement>('#rules-json');
    this.rulesValidationLine = requireNode<HTMLDivElement>('#rules-validation-line');
    this.rulesInspector = requireNode<HTMLDivElement>('#rules-inspector');
    this.fullscreenButton = requireNode<HTMLButtonElement>('#fullscreen-toggle');
    this.resetRulesButton = requireNode<HTMLButtonElement>('#reset-rules');
    this.applyRulesButton = requireNode<HTMLButtonElement>('#apply-rules');
    this.copyRulesButton = requireNode<HTMLButtonElement>('#copy-rules');
    this.rulesExampleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.rules-example'));
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
      team: 'players',
    });
    this.spawnNpcSpawns(this.ruleset.npcs.sessionSpawns, 'session');
    this.unsubscribeSnapshot = this.engine.onSnapshot((snapshot) => {
      this.consumeSnapshot(snapshot, `hosting: ${room.name}`);
      this.hostSession?.broadcastSnapshot(snapshot);
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

  private async startSolo(lab: boolean): Promise<void> {
    const selectedRuleset = this.readRulesForStart();
    if (!selectedRuleset) {
      return;
    }
    this.stopActiveMode();
    this.mode = lab ? 'lab' : 'solo';
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
      team: 'players',
      spawnPoint: lab ? { x: -10, y: -7 } : undefined,
    });
    if (lab) {
      this.resetLabState();
      this.spawnNpcSpawns(this.ruleset.npcs.labSpawns, 'lab');
      this.syncLabControls();
    } else {
      this.spawnNpcSpawns(this.ruleset.npcs.sessionSpawns, 'session');
    }
    this.unsubscribeSnapshot = this.engine.onSnapshot((snapshot) => {
      this.consumeSnapshot(snapshot, lab ? 'lab: test bench' : 'solo: browser worker authority');
    });
    this.hashLine.textContent = `rules ${shortHash(rulesetHash)} · content ${shortHash(this.ruleset.contentHash)}`;
    this.setStatus(lab ? 'lab: test bench' : 'solo: browser worker authority');
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
      this.consumeSnapshot(snapshot, `joined: ${room.name}`);
    });
    await this.clientSession.connect(room);
    this.setStatus(`joining: ${room.name}`);
  }

  private handleInput(input: PlayerInput): void {
    if (!this.localPlayerId) {
      return;
    }
    if (this.mode === 'host' || this.mode === 'solo' || this.mode === 'lab') {
      this.engine?.submitInput(this.localPlayerId, input);
      return;
    }
    if (this.mode === 'client') {
      this.clientSession?.submitInput(input);
    }
  }

  private stopActiveMode(): void {
    this.input.reset(Boolean(this.localPlayerId));
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
    this.previousSlotCooldowns = undefined;
    this.resetLabState();
    window.__BEAT_SNAPSHOT__ = undefined;
    window.__BEAT_TRACE__ = undefined;
    window.__BEAT_AI_TRACE__ = undefined;
    this.renderer.setRuleset(undefined);
    this.renderer.setEmptyMessage('No room active');
    this.renderer.setLocalPlayer(undefined);
    this.input.setAimOrigin(undefined);
    this.updateSkillBar(undefined);
    this.updateLocalMechanics(undefined);
    this.renderTrace([], []);
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
    const humans = this.lastSnapshot?.players.filter((player) => player.role === 'player').length ?? 0;
    const actors = this.lastSnapshot?.players.length ?? 0;
    const text = `${status} · humans ${humans} · actors ${actors}`;
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
    void this.refreshRulesInspector();
    return this.editableRuleset;
  }

  private spawnNpcSpawns(spawns: NpcSpawn[], scope: 'lab' | 'session'): void {
    for (const spawn of spawns) {
      const archetype = this.ruleset?.npcs.archetypes.find((candidate) => candidate.id === spawn.archetypeId);
      if (!archetype) {
        continue;
      }
      const playerId = `${scope}-npc-${spawn.id}`;
      this.addNpcActor(playerId, archetype, { x: spawn.x, y: spawn.y }, spawn.team);
      if (scope === 'lab') {
        this.labActorIds.add(playerId);
      }
    }
  }

  private addNpcActor(playerId: string, archetype: NpcArchetype, spawnPoint: { x: number; y: number }, teamOverride?: string): void {
    const team = teamOverride ?? archetype.team;
    this.engine?.addPlayer({
      playerId,
      displayName: archetype.name,
      hue: archetype.hue,
      local: false,
      role: 'npc',
      team,
      npc: npcRuntimeConfig(archetype, team),
      spawnPoint,
    });
  }

  private consumeSnapshot(snapshot: EngineSnapshot, status: string): void {
    this.lastSnapshot = snapshot;
    window.__BEAT_SNAPSHOT__ = snapshot;
    window.__BEAT_TRACE__ = snapshot.mechanicTraces;
    window.__BEAT_AI_TRACE__ = snapshot.aiTraces;
    this.renderer.update(snapshot);
    this.updateAimOrigin(snapshot);
    this.updateSkillBar(snapshot);
    this.updateLocalMechanics(snapshot);
    this.renderTrace(snapshot.mechanicTraces, snapshot.aiTraces);
    this.setStatus(status);
  }

  private spawnSelectedLabActor(): void {
    if (this.mode !== 'lab' || !this.ruleset) {
      return;
    }
    const archetype = this.ruleset.npcs.archetypes.find((candidate) => candidate.id === this.labSpawnSelect.value);
    if (!archetype) {
      return;
    }
    const index = this.labSpawnIndex++;
    const playerId = `lab-npc-manual-${index}`;
    const spawnPoint = {
      x: -2.8 + (index % 5) * 1.6,
      y: -5.8 + Math.floor(index / 5) * 1.35,
    };
    this.addNpcActor(playerId, archetype, spawnPoint);
    this.labActorIds.add(playerId);
    this.log(`lab spawned ${archetype.name}`);
  }

  private clearLabActors(): void {
    if (this.mode !== 'lab') {
      return;
    }
    for (const playerId of this.labActorIds) {
      this.engine?.removePlayer(playerId);
    }
    this.labActorIds.clear();
    this.log('lab actors cleared');
  }

  private resetLabActors(): void {
    if (this.mode !== 'lab' || !this.ruleset) {
      return;
    }
    this.clearLabActors();
    this.spawnNpcSpawns(this.ruleset.npcs.labSpawns, 'lab');
    this.clearLabTrace();
    this.log('lab actors reset');
  }

  private clearLabTrace(): void {
    this.engine?.clearTrace();
    window.__BEAT_TRACE__ = [];
    window.__BEAT_AI_TRACE__ = [];
    this.renderTrace([], []);
  }

  private toggleLabPause(): void {
    if (this.mode !== 'lab') {
      return;
    }
    this.labPaused = !this.labPaused;
    this.engine?.setPaused(this.labPaused);
    this.syncLabControls();
    this.log(this.labPaused ? 'lab paused' : 'lab resumed');
  }

  private resetLabState(): void {
    this.labActorIds.clear();
    this.labSpawnIndex = 0;
    this.labPaused = false;
    this.syncLabControls();
  }

  private syncLabControls(): void {
    if (!this.labControlsRoot) {
      return;
    }
    const labActive = this.mode === 'lab';
    this.labControlsRoot.hidden = !labActive;
    this.labPauseButton.textContent = this.labPaused ? 'Resume' : 'Pause';
    this.labPauseButton.setAttribute('aria-pressed', String(this.labPaused));
    const archetypes = this.ruleset?.npcs.archetypes ?? this.editableRuleset.npcs.archetypes;
    this.labSpawnSelect.replaceChildren(
      ...archetypes.map((archetype) => {
        const option = document.createElement('option');
        option.value = archetype.id;
        option.textContent = archetype.name;
        return option;
      }),
    );
    this.labSpawnButton.disabled = !labActive || archetypes.length === 0;
    this.labClearActorsButton.disabled = !labActive;
    this.labResetButton.disabled = !labActive;
    this.labClearTraceButton.disabled = !labActive;
    this.labPauseButton.disabled = !labActive;
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
    await this.refreshRulesInspector();
  }

  private async refreshRulesInspector(): Promise<void> {
    const refreshId = ++this.rulesInspectorRefreshId;
    try {
      const ruleset = parseRulesetJson(this.rulesJsonInput.value);
      const hash = await hashRuleset(ruleset);
      if (refreshId !== this.rulesInspectorRefreshId) {
        return;
      }
      this.editableRulesetHash = hash;
      this.rulesHashLine.textContent = `${ruleset.name} · ${shortHash(hash)}`;
      this.rulesValidationLine.textContent = `valid · ${ruleset.abilities.length} abilities · ${ruleset.mechanics.statuses.length} statuses · ${ruleset.mechanics.triggers.length} triggers · ${ruleset.npcs.archetypes.length} NPCs`;
      this.rulesValidationLine.classList.remove('is-error');
      this.rulesInspector.innerHTML = rulesInspectorHtml(ruleset);
      this.syncLabControls();
    } catch (error) {
      if (refreshId !== this.rulesInspectorRefreshId) {
        return;
      }
      this.rulesValidationLine.textContent = `invalid · ${readError(error)}`;
      this.rulesValidationLine.classList.add('is-error');
      this.rulesInspector.innerHTML = '<div class="inspector-empty">Invalid JSON</div>';
    }
  }

  private async insertRulesExample(example: string): Promise<void> {
    try {
      const ruleset = parseRulesetJson(this.rulesJsonInput.value);
      const nextRuleset = applyRulesExample(ruleset, example);
      this.rulesJsonInput.value = stringifyRuleset(validateRuleset(nextRuleset));
      await this.refreshRulesInspector();
      this.log(`rules example applied: ${example}`);
    } catch (error) {
      this.log(`rules example rejected: ${readError(error)}`);
    }
  }

  private showMenu(): void {
    this.menuView.hidden = false;
    this.arenaView.hidden = true;
    this.syncLabControls();
  }

  private showArena(): void {
    blurActiveElement();
    this.menuView.hidden = true;
    this.arenaView.hidden = false;
    this.syncLabControls();
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
    for (const button of this.rulesExampleButtons) {
      button.disabled = locked;
    }
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
    const nextCooldowns: number[] = [];
    for (const [index, button] of this.skillButtons.entries()) {
      const abilityId = ruleset?.loadout.abilityIds[index];
      const ability = abilityId ? ruleset?.abilities.find((candidate) => candidate.id === abilityId) : undefined;
      const cooldown = local?.slotCooldownTicks[index] ?? 0;
      const wasCooling = (this.previousSlotCooldowns?.[index] ?? 0) > 0;
      const charging = local?.charging?.slot === index;
      const chargeRatio = charging ? local.charging?.ratio ?? 0 : 0;
      const ratio = ability && ability.cooldownTicks > 0 ? Math.max(0, Math.min(1, cooldown / ability.cooldownTicks)) : 0;
      nextCooldowns[index] = cooldown;
      button.style.setProperty('--skill-color', ability?.color ?? '#6a6760');
      button.style.setProperty('--cooldown-ratio', String(ratio));
      button.style.setProperty('--charge-ratio', String(chargeRatio));
      button.classList.toggle('is-cooling', cooldown > 0);
      button.classList.toggle('is-charging', charging);
      button.classList.toggle('is-unavailable', !ability || Boolean(local && !local.alive));
      button.disabled = !ability || Boolean(local && !local.alive);
      if (ability && local?.alive && wasCooling && cooldown === 0) {
        button.classList.remove('is-ready-flash');
        void button.offsetWidth;
        button.classList.add('is-ready-flash');
      }
      button.title = ability ? `${index + 1} ${ability.name}` : `Slot ${index + 1}`;
      button.setAttribute('aria-label', ability ? `Slot ${index + 1}: ${ability.name}` : `Slot ${index + 1}`);
      button.querySelector('.skill-slot__name')?.replaceChildren(document.createTextNode(ability?.name ?? `Slot ${index + 1}`));
      button.querySelector('.skill-slot__timer')?.replaceChildren(document.createTextNode(cooldown > 0 ? String(cooldown) : ''));
    }
    this.previousSlotCooldowns = snapshot ? nextCooldowns : undefined;
  }

  private updateLocalMechanics(snapshot: EngineSnapshot | undefined): void {
    const local = this.localPlayerId ? snapshot?.players.find((player) => player.playerId === this.localPlayerId) : undefined;
    if (!local) {
      this.localMechanicsRoot.replaceChildren();
      return;
    }
    const chips = [
      ...local.resources.map((resource) =>
        mechanicsChipHtml(resource.name, `${Math.round(resource.value)}/${Math.round(resource.max)}`, resource.color),
      ),
      ...local.statuses.map((status) =>
        mechanicsChipHtml(status.name, status.stacks > 1 ? `${status.stacks}x` : `${Math.ceil(status.remainingTicks / (this.ruleset?.tickRate ?? 30))}s`, status.color),
      ),
    ];
    this.localMechanicsRoot.innerHTML = chips.length > 0 ? chips.join('') : '<span class="mechanic-chip mechanic-chip--empty">No statuses</span>';
  }

  private renderTrace(mechanicTraces: MechanicTraceSnapshot[], aiTraces: AiTraceSnapshot[]): void {
    const visible = [
      ...mechanicTraces.map((trace) => ({ tick: trace.tick, type: 'mechanic' as const, trace })),
      ...aiTraces.map((trace) => ({ tick: trace.tick, type: 'ai' as const, trace })),
    ]
      .sort((a, b) => a.tick - b.tick)
      .slice(-18)
      .reverse();
    this.traceRoot.innerHTML =
      visible.length > 0
        ? visible
            .map((entry) =>
              entry.type === 'mechanic'
                ? `<div class="trace-line trace-line--${entry.trace.kind}">${escapeHtml(traceLabel(entry.trace))}</div>`
                : `<div class="trace-line trace-line--ai-${entry.trace.kind}">${escapeHtml(aiTraceLabel(entry.trace))}</div>`,
            )
            .join('')
        : '<div class="trace-line trace-line--empty">No mechanics yet</div>';
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
            <p>PWA hosted arena rooms</p>
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
            <div class="button-grid button-grid--lobby">
              <button id="host-room" class="button button--primary" type="button">Host</button>
              <button id="solo-room" class="button" type="button">Solo</button>
              <button id="lab-room" class="button" type="button">Lab</button>
            </div>
            <div id="menu-status-line" class="menu-status">starting</div>
            <section class="room-section">
              <h2>Rooms</h2>
              <div id="room-list" class="room-list"></div>
            </section>
          </section>
          <section class="menu-section menu-section--rules">
            <h2>Rules JSON</h2>
            <div class="rules-workbench">
              <div class="rules-editor">
                <div id="rules-hash-line" class="rules-hash">rules hash</div>
                <div id="rules-validation-line" class="rules-validation">validating</div>
                <textarea id="rules-json" class="rules-json" spellcheck="false"></textarea>
                <div class="button-grid button-grid--rules">
                  <button id="apply-rules" class="button button--primary" type="button">Apply</button>
                  <button id="copy-rules" class="button" type="button">Copy</button>
                  <button id="reset-rules" class="button button--danger" type="button">Reset</button>
                </div>
              </div>
              <aside class="rules-panel">
                <div class="rules-examples">
                  <button class="button rules-example" type="button" data-example="combo-preset">Combo Preset</button>
                  <button class="button rules-example" type="button" data-example="bleed-dot">Bleed DOT</button>
                  <button class="button rules-example" type="button" data-example="execute">Execute</button>
                  <button class="button rules-example" type="button" data-example="physics-preset">Physics</button>
                </div>
                <div id="rules-inspector" class="rules-inspector"></div>
              </aside>
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
          <div id="local-mechanics" class="local-mechanics"></div>
        </div>
        <div class="arena-actions">
          <button id="fullscreen-toggle" class="button arena-action-button" type="button" aria-pressed="false">Fullscreen</button>
          <button id="leave-room" class="button arena-action-button" type="button">Menu</button>
        </div>
        <div id="lab-controls" class="lab-controls" hidden>
          <div class="lab-controls__title">Lab Bench</div>
          <div class="lab-controls__row">
            <button id="lab-pause" class="button lab-control-button" type="button" aria-pressed="false">Pause</button>
            <button id="lab-reset" class="button lab-control-button" type="button">Reset</button>
            <button id="lab-clear-trace" class="button lab-control-button" type="button">Clear Trace</button>
          </div>
          <div class="lab-controls__row">
            <select id="lab-spawn-select" class="lab-select" aria-label="NPC archetype"></select>
            <button id="lab-spawn" class="button lab-control-button" type="button">Spawn</button>
            <button id="lab-clear-actors" class="button lab-control-button" type="button">Clear Actors</button>
          </div>
        </div>
        <div id="skill-bar" class="skill-bar" aria-label="Skill bar">
          <button class="skill-slot" type="button" data-slot="0">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__charge-fill"></span>
            <span class="skill-slot__key">1</span>
            <span class="skill-slot__name">Slot 1</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="1">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__charge-fill"></span>
            <span class="skill-slot__key">2</span>
            <span class="skill-slot__name">Slot 2</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="2">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__charge-fill"></span>
            <span class="skill-slot__key">3</span>
            <span class="skill-slot__name">Slot 3</span>
            <span class="skill-slot__timer"></span>
          </button>
          <button class="skill-slot" type="button" data-slot="3">
            <span class="skill-slot__cooldown-fill"></span>
            <span class="skill-slot__charge-fill"></span>
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
          <summary>Trace / Log</summary>
          <div class="arena-log__title">Mechanics</div>
          <div id="trace-log" class="trace-log"></div>
          <div class="arena-log__title">Session</div>
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

function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function rulesInspectorHtml(ruleset: Ruleset): string {
  return [
    inspectorGroup(
      'Abilities',
      ruleset.abilities.map((ability) =>
        inspectorRow(
          ability.name,
          abilityMeta(ability),
          abilityDetail(ability),
          ability.color,
        ),
      ),
    ),
    inspectorGroup(
      'Statuses',
      ruleset.mechanics.statuses.map((status) =>
        inspectorRow(
          status.name,
          [`${status.durationTicks} ticks`, ...(status.tags ?? [])].join(' · '),
          [
            status.movementMultiplier === undefined ? undefined : `move x${status.movementMultiplier}`,
            status.damageDealtMultiplier === undefined ? undefined : `deal x${status.damageDealtMultiplier}`,
            status.damageTakenMultiplier === undefined ? undefined : `taken x${status.damageTakenMultiplier}`,
            status.periodic ? `periodic ${status.periodic.everyTicks}` : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || 'marker',
          status.color,
        ),
      ),
    ),
    inspectorGroup(
      'Resources',
      ruleset.mechanics.resources.map((resource) =>
        inspectorRow(resource.name, `${resource.start}/${resource.max}`, `regen ${resource.regenPerTick}`, resource.color),
      ),
    ),
    inspectorGroup(
      'Triggers',
      ruleset.mechanics.triggers.map((trigger) =>
        inspectorRow(
          trigger.name ?? trigger.id,
          trigger.event,
          triggerDetail(trigger),
          '#ffe66d',
        ),
      ),
    ),
    inspectorGroup(
      'NPCs',
      ruleset.npcs.archetypes.map((archetype) =>
        inspectorRow(
          archetype.name,
          `${archetype.id} · ${archetype.behavior.mode} · team ${archetype.team}`,
          `loadout ${archetype.loadout.abilityIds.join(', ') || 'none'} · cast ${archetype.casting.slots.map((slot) => slot + 1).join(', ') || 'none'} · x${archetype.hpMultiplier} hp`,
          `hsl(${archetype.hue} 76% 58%)`,
        ),
      ),
    ),
    inspectorGroup(
      'NPC Spawns',
      [
        ...ruleset.npcs.labSpawns.map((spawn) =>
          inspectorRow(spawn.id, `lab · ${spawn.archetypeId}`, `${spawn.x}, ${spawn.y}${spawn.team ? ` · team ${spawn.team}` : ''}`, '#2fd17c'),
        ),
        ...ruleset.npcs.sessionSpawns.map((spawn) =>
          inspectorRow(spawn.id, `session · ${spawn.archetypeId}`, `${spawn.x}, ${spawn.y}${spawn.team ? ` · team ${spawn.team}` : ''}`, '#ff6b4a'),
        ),
      ],
    ),
  ].join('');
}

function inspectorGroup(title: string, rows: string[]): string {
  const body = rows.length > 0 ? rows.join('') : '<div class="inspector-empty">None</div>';
  return `<section class="inspector-group"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function inspectorRow(title: string, meta: string, detail: string, color: string): string {
  return `
    <div class="inspector-row">
      <span class="inspector-swatch" style="--swatch:${escapeHtml(color)}"></span>
      <span class="inspector-row__main">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(meta)}</small>
        <small>${escapeHtml(detail)}</small>
      </span>
    </div>
  `;
}

function abilityMeta(ability: Ruleset['abilities'][number]): string {
  return [
    ability.shape,
    ability.targeting,
    ability.shape === 'projectile' && ability.worldCollision === 'phase' ? 'phase walls' : undefined,
    ...(ability.tags ?? []),
  ]
    .filter(Boolean)
    .join(' · ');
}

function abilityDetail(ability: Ruleset['abilities'][number]): string {
  const physicsEffects = (ability.effects ?? []).map(physicsEffectLabel).filter(Boolean);
  return [
    `${ability.damage} dmg`,
    `${ability.cooldownTicks} cd`,
    `${(ability.effects ?? []).length} effects`,
    physicsEffects.length > 0 ? physicsEffects.join(', ') : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function physicsEffectLabel(effect: NonNullable<Ruleset['abilities'][number]['effects']>[number]): string | undefined {
  if (effect.kind === 'spawnBody') {
    return `body r${effect.body.radius}`;
  }
  if (effect.kind === 'snare') {
    return `snare ${effect.radius}`;
  }
  if (effect.kind === 'dragBody') {
    return `drag ${effect.leashLength}`;
  }
  return undefined;
}

function triggerDetail(trigger: Ruleset['mechanics']['triggers'][number]): string {
  const conditions = trigger.conditions?.map(conditionLabel).join(' + ') ?? 'always';
  const actions = trigger.actions.map(actionLabel).join(' + ');
  return `${conditions} -> ${actions}`;
}

function conditionLabel(condition: MechanicCondition): string {
  if (condition.kind === 'hasStatus' || condition.kind === 'missingStatus') {
    return `${condition.target} ${condition.kind} ${condition.statusId}`;
  }
  if (condition.kind === 'hpBelow') {
    return `${condition.target} hp < ${Math.round(condition.ratio * 100)}%`;
  }
  if (condition.kind === 'resourceAtLeast') {
    return `${condition.target} ${condition.resourceId} >= ${condition.amount}`;
  }
  if (condition.kind === 'slotUsed') {
    return `slot ${condition.slot + 1}`;
  }
  return `tag ${condition.tag}`;
}

function actionLabel(action: MechanicAction): string {
  if (action.kind === 'applyStatus' || action.kind === 'removeStatus') {
    return `${action.kind} ${action.statusId}`;
  }
  if (action.kind === 'modifyResource') {
    return `${action.resourceId} ${action.amount > 0 ? '+' : ''}${action.amount}`;
  }
  if (action.kind === 'dealDamage' || action.kind === 'heal') {
    return `${action.kind} ${action.amount}`;
  }
  if (action.kind === 'knockback') {
    return `knockback ${action.force}`;
  }
  if (action.kind === 'slow') {
    return `slow x${action.multiplier}`;
  }
  return `flash ${action.radius}`;
}

function mechanicsChipHtml(label: string, value: string, color: string): string {
  return `<span class="mechanic-chip" style="--chip-color:${escapeHtml(color)}"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></span>`;
}

function traceLabel(trace: MechanicTraceSnapshot): string {
  const source = trace.sourceName ?? shortTraceId(trace.sourceId) ?? 'system';
  const target = trace.targetName ?? shortTraceId(trace.targetId);
  const ability = trace.abilityName ?? trace.abilityId;
  if (trace.kind === 'physics') {
    return `${trace.tick} physics ${trace.physicsKind ?? 'event'} ${ability ? `via ${ability}` : ''}${target ? ` ${source}->${target}` : ` ${source}`}`.trim();
  }
  if (trace.kind === 'event') {
    return `${trace.tick} ${trace.event ?? 'event'} ${ability ? `via ${ability}` : ''} ${target ? `${source}->${target}` : source}`.trim();
  }
  if (trace.kind === 'trigger') {
    return `${trace.tick} trigger ${trace.triggerName ?? trace.triggerId ?? 'unknown'} fired`;
  }
  if (trace.kind === 'condition-failed') {
    return `${trace.tick} skip ${trace.triggerName ?? trace.triggerId ?? 'trigger'}: ${trace.conditionKind ?? 'condition'}`;
  }
  if (trace.kind === 'action') {
    return `${trace.tick} action ${trace.actionKind ?? 'action'}${trace.statusId ? ` ${trace.statusId}` : ''}${trace.resourceId ? ` ${trace.resourceId}` : ''}${trace.amount === undefined ? '' : ` ${Math.round(trace.amount)}`}`;
  }
  return `${trace.tick} mechanics guard blocked queued events`;
}

function aiTraceLabel(trace: AiTraceSnapshot): string {
  const actor = trace.actorName ?? shortTraceId(trace.actorId) ?? 'npc';
  const target = trace.targetName ?? shortTraceId(trace.targetId);
  if (trace.kind === 'target') {
    return `${trace.tick} ai ${actor} ${trace.result === 'acquired' ? `target ${target ?? 'enemy'}` : trace.reason ?? 'no target'}`;
  }
  if (trace.kind === 'move') {
    return `${trace.tick} ai ${actor} ${trace.behavior ?? 'move'}${target ? ` toward ${target}` : ''}`;
  }
  if (trace.kind === 'cast') {
    return `${trace.tick} ai ${actor} cast ${trace.abilityId ?? `slot ${trace.slot ?? 0}`}${target ? ` at ${target}` : ''}`;
  }
  return `${trace.tick} ai ${actor} blocked ${trace.abilityId ?? `slot ${trace.slot ?? 0}`}: ${trace.reason ?? 'blocked'}`;
}

function shortTraceId(value: string | undefined): string | undefined {
  return value ? value.slice(-8) : undefined;
}

function npcRuntimeConfig(archetype: NpcArchetype, team: string): RuntimeNpcConfig {
  return {
    archetypeId: archetype.id,
    team,
    hpMultiplier: archetype.hpMultiplier,
    speedMultiplier: archetype.speedMultiplier,
    loadoutAbilityIds: archetype.loadout.abilityIds,
    behavior: archetype.behavior,
    casting: archetype.casting,
  };
}

function applyRulesExample(ruleset: Ruleset, example: string): Ruleset {
  if (example === 'combo-preset') {
    return createDefaultRuleset();
  }
  if (example === 'physics-preset') {
    const preset = createDefaultRuleset();
    preset.loadout.abilityIds = ['anchor-orb', 'wrecking-weight', 'seeker-spark', 'ion-lance'];
    return preset;
  }
  const next = structuredClone(ruleset) as Ruleset;
  if (example === 'bleed-dot') {
    upsertById(next.mechanics.statuses, {
      id: 'bleeding',
      name: 'Bleeding',
      color: '#e0524d',
      durationTicks: 120,
      tags: ['bleed'],
      periodic: {
        everyTicks: 24,
        actions: [{ kind: 'dealDamage', target: 'target', amount: 4, color: '#e0524d' }],
      },
    });
    const arcSlash = next.abilities.find((ability) => ability.id === 'arc-slash');
    if (arcSlash) {
      arcSlash.effects = [...(arcSlash.effects ?? []).filter((effect) => effect.kind !== 'applyStatus' || effect.statusId !== 'bleeding'), {
        kind: 'applyStatus',
        target: 'hit',
        statusId: 'bleeding',
      }];
      arcSlash.tags = Array.from(new Set([...(arcSlash.tags ?? []), 'bleed']));
    }
    return next;
  }
  if (example === 'execute') {
    upsertById(next.mechanics.triggers, {
      id: 'low-hp-execute',
      name: 'Low HP Execute',
      event: 'onHit',
      conditions: [{ kind: 'hpBelow', target: 'target', ratio: 0.3 }],
      actions: [
        { kind: 'dealDamage', target: 'target', amount: 16, color: '#ffffff' },
        { kind: 'flashEffect', target: 'target', radius: 1.8, color: '#ffffff' },
      ],
    });
    return next;
  }
  return next;
}

function upsertById<T extends { id: string }>(values: T[], value: T): void {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index >= 0) {
    values[index] = value;
    return;
  }
  values.push(value);
}
