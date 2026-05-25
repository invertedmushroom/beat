import { createDefaultRuleset } from './engine/defaultRules';
import { EngineClient } from './engine/EngineClient';
import { hashRuleset } from './engine/rulesHash';
import { validateRuleset } from './engine/rulesValidation';
import type {
  AiTraceSnapshot,
  EngineSnapshot,
  MechanicTraceSnapshot,
  NpcArchetype,
  NpcSpawn,
  PlayerInput,
  Ruleset,
  RuntimeNpcConfig,
} from './engine/protocol';
import { InputController, type TouchControlElements } from './input/InputController';
import { SnapshotSmoother, type SnapshotSmoothingStats } from './net/snapshotSmoothing';
import { HostSession, ClientSession, type NetDiagnostics } from './net/webrtc';
import { CanvasRenderer } from './render/CanvasRenderer';
import type { RoomInfo } from './rooms/directory';
import { createRoomDirectory } from './rooms/directoryFactory';
import { defaultUiPreferences, loadUiPreferences, saveUiPreferences, type UiPreferences } from './ui/preferences';
import {
  applyWorkbenchFieldEdit,
  diagnosticsFromError,
  workbenchEditFromControl,
  workbenchFieldPath,
  type WorkbenchDiagnostic,
} from './ui/workbench/fields';
import { escapeHtml, formatMeters, aiTraceLabel, mechanicsChipHtml, mechanicsFlowHtml, rulesInspectorHtml, traceLabel } from './ui/workbench/inspector';
import { parseWorkbenchDocumentJson, stringifyRulesDocument } from './ui/workbench/jsonSync';
import {
  createWorkbenchState,
  ensureWorkbenchSelections,
  isWorkbenchTab,
  updateWorkbenchDraft,
  type WorkbenchState,
  type WorkbenchTab,
} from './ui/workbench/state';
import { workbenchHtml } from './ui/workbench/view';
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
  private workbenchButton!: HTMLButtonElement;
  private workbenchBackButton!: HTMLButtonElement;
  private leaveButton!: HTMLButtonElement;
  private roomList!: HTMLDivElement;
  private statusLine!: HTMLDivElement;
  private menuStatusLine!: HTMLDivElement;
  private hashLine!: HTMLDivElement;
  private rulesHashLine!: HTMLDivElement;
  private peerLine!: HTMLDivElement;
  private networkLine!: HTMLDivElement;
  private matchLine!: HTMLDivElement;
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
  private workbenchView!: HTMLElement;
  private workbenchTabsRoot!: HTMLElement;
  private workbenchPanelsRoot!: HTMLElement;
  private arenaView!: HTMLElement;
  private rulesJsonInput!: HTMLTextAreaElement;
  private rulesValidationLine!: HTMLDivElement;
  private rulesInspector!: HTMLDivElement;
  private workbenchDiagnosticsRoot!: HTMLDivElement;
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
  private snapshotSmoother?: SnapshotSmoother;
  private networkStats?: NetDiagnostics;
  private smoothingStats?: SnapshotSmoothingStats;
  private previousSlotCooldowns?: number[];
  private editableRuleset: Ruleset = createDefaultRuleset();
  private editableRulesetHash = '';
  private rulesInspectorRefreshId = 0;
  private uiPreferences: UiPreferences = defaultUiPreferences();
  private workbenchState: WorkbenchState = createWorkbenchState(this.editableRuleset);
  private workbenchDiagnostics: WorkbenchDiagnostic[] = [];
  private labActorIds = new Set<string>();
  private labSpawnIndex = 0;
  private labPaused = false;

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = shellHtml();
    this.bindDom();
    this.uiPreferences = loadUiPreferences();
    this.renderer = new CanvasRenderer(this.canvas);
    this.input = new InputController(this.canvas, this.touchControls());
    this.applyUiPreferences();
  }

  start(): void {
    this.renderer.start();
    this.input.start();
    this.unsubscribeInput = this.input.onInput((input) => this.handleInput(input));
    this.unsubscribeRooms = this.directory.subscribeRooms((rooms) => this.renderRooms(rooms));
    this.hostButton.addEventListener('click', () => void this.hostRoom());
    this.soloButton.addEventListener('click', () => void this.startSolo(false));
    this.labButton.addEventListener('click', () => void this.startSolo(true));
    this.workbenchButton.addEventListener('click', () => this.showWorkbench());
    this.workbenchBackButton.addEventListener('click', () => this.showMenu());
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
    this.workbenchTabsRoot.addEventListener('click', (event) => this.handleWorkbenchTabClick(event));
    this.workbenchTabsRoot.addEventListener('keydown', (event) => this.handleWorkbenchTabKeydown(event));
    this.workbenchDiagnosticsRoot.addEventListener('click', (event) => this.handleWorkbenchDiagnosticClick(event));
    this.workbenchView.addEventListener('input', (event) => void this.handleWorkbenchInput(event));
    this.workbenchView.addEventListener('change', (event) => void this.handleWorkbenchInput(event));
    for (const button of this.rulesExampleButtons) {
      button.addEventListener('click', () => void this.insertRulesExample(button.dataset.example ?? ''));
    }
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
    this.syncWorkbenchControls();
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
    this.workbenchView = requireNode<HTMLElement>('#workbench-view');
    this.workbenchTabsRoot = requireNode<HTMLElement>('#workbench-tabs');
    this.workbenchPanelsRoot = requireNode<HTMLElement>('#workbench-panels');
    this.arenaView = requireNode<HTMLElement>('#arena-view');
    this.displayNameInput = requireNode<HTMLInputElement>('#display-name');
    this.roomNameInput = requireNode<HTMLInputElement>('#room-name');
    this.hostButton = requireNode<HTMLButtonElement>('#host-room');
    this.soloButton = requireNode<HTMLButtonElement>('#solo-room');
    this.labButton = requireNode<HTMLButtonElement>('#lab-room');
    this.workbenchButton = requireNode<HTMLButtonElement>('#open-workbench');
    this.workbenchBackButton = requireNode<HTMLButtonElement>('#workbench-back-menu');
    this.leaveButton = requireNode<HTMLButtonElement>('#leave-room');
    this.roomList = requireNode<HTMLDivElement>('#room-list');
    this.statusLine = requireNode<HTMLDivElement>('#status-line');
    this.menuStatusLine = requireNode<HTMLDivElement>('#menu-status-line');
    this.hashLine = requireNode<HTMLDivElement>('#hash-line');
    this.rulesHashLine = requireNode<HTMLDivElement>('#rules-hash-line');
    this.peerLine = requireNode<HTMLDivElement>('#peer-line');
    this.networkLine = requireNode<HTMLDivElement>('#network-line');
    this.matchLine = requireNode<HTMLDivElement>('#match-line');
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
    this.workbenchDiagnosticsRoot = requireNode<HTMLDivElement>('#workbench-diagnostics');
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
      team: this.ruleset.match.teams[0]?.id ?? 'players',
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
      rulesetName: this.ruleset.name,
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
    this.hostSession.onStats((stats) => {
      this.networkStats = stats;
      this.updateNetworkLine();
    });
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
      team: this.ruleset.match.teams[0]?.id ?? 'players',
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
    if (room.status !== 'open' || room.playerCount >= room.maxPlayers) {
      this.log(`join blocked: ${room.name} is full`);
      this.setStatus(`room unavailable: ${room.name}`);
      return;
    }
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
      this.snapshotSmoother = new SnapshotSmoother(ruleset, playerId);
      this.renderer.setSnapshotProvider(() => {
        const renderSnapshot = this.snapshotSmoother?.render(performance.now(), this.clientSession?.pendingInputs() ?? []);
        this.smoothingStats = this.snapshotSmoother?.stats();
        if (renderSnapshot) {
          window.__BEAT_RENDER_SNAPSHOT__ = renderSnapshot;
        }
        return renderSnapshot;
      });
      this.renderer.setRuleset(ruleset);
      this.renderer.setEmptyMessage('No room active');
      this.renderer.setLocalPlayer(playerId);
      this.hashLine.textContent = `rules ${shortHash(joinedRoom.rulesetHash)} · content ${shortHash(joinedRoom.contentHash)}`;
      this.setStatus(`joined: ${joinedRoom.name}`);
    });
    this.clientSession.onStats((stats) => {
      this.networkStats = stats;
      this.smoothingStats = this.snapshotSmoother?.stats();
      this.updateNetworkLine();
    });
    this.clientSession.onSnapshot((snapshot) => {
      this.consumeSnapshot(snapshot, `joined: ${room.name}`);
    });
    try {
      await this.clientSession.connect(room);
      this.setStatus(`joining: ${room.name}`);
    } catch (error: unknown) {
      this.log(`join failed: ${readError(error)}`);
      this.stopActiveMode();
    }
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
    this.snapshotSmoother = undefined;
    this.networkStats = undefined;
    this.smoothingStats = undefined;
    this.previousSlotCooldowns = undefined;
    this.resetLabState();
    window.__BEAT_SNAPSHOT__ = undefined;
    window.__BEAT_RENDER_SNAPSHOT__ = undefined;
    window.__BEAT_NET_STATS__ = undefined;
    window.__BEAT_TRACE__ = undefined;
    window.__BEAT_AI_TRACE__ = undefined;
    this.renderer.setSnapshotProvider(undefined);
    this.renderer.setRuleset(undefined);
    this.renderer.setEmptyMessage('No room active');
    this.renderer.setLocalPlayer(undefined);
    this.input.setAimOrigin(undefined);
    this.updateSkillBar(undefined);
    this.updateLocalMechanics(undefined);
    this.updateMatchHud(undefined);
    this.updateNetworkLine();
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
      const joinable = room.status === 'open' && room.playerCount < room.maxPlayers;
      row.className = 'room-row';
      row.type = 'button';
      row.disabled = !joinable;
      const rulesLabel = room.rulesetName ? `${room.rulesetName} (${room.rulesetId})` : room.rulesetId;
      row.innerHTML = `
        <span class="room-row__name">${escapeHtml(room.name)}</span>
        <span class="room-row__meta">${room.playerCount}/${room.maxPlayers}${joinable ? '' : ' · full'} · rules ${escapeHtml(rulesLabel)}</span>
        <span class="room-row__meta room-row__meta--sub">map ${escapeHtml(room.mapBundleId)} · content ${shortHash(room.contentHash)} · rules ${shortHash(room.rulesetHash)}</span>
      `;
      if (joinable) {
        row.addEventListener('click', () => void this.joinRoom(room));
      }
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

  private updateNetworkLine(): void {
    const stats = this.networkStats;
    const smoothing = this.smoothingStats;
    if (!stats) {
      this.networkLine.textContent = this.mode === 'client' || this.mode === 'host' ? 'net waiting' : 'net idle';
      window.__BEAT_NET_STATS__ = undefined;
      return;
    }
    window.__BEAT_NET_STATS__ = {
      ...stats,
      predictionErrorEwma: smoothing?.predictionErrorEwma,
      predictionErrorMax: smoothing?.predictionErrorMax,
      remoteExtrapolationSeconds: smoothing?.remoteExtrapolationSeconds,
      remoteExtrapolationEvents: smoothing?.remoteExtrapolationEvents,
    };
    const relay = stats.candidateType === 'unknown' ? 'ice unknown' : stats.relay ? 'TURN relay' : `${stats.candidateType} direct`;
    const rtt = stats.rttMs === undefined ? 'rtt --' : `rtt ${Math.round(stats.rttMs)}ms`;
    const rate = `${Math.round(stats.bytesPerSecond / 1024)}KB/s`;
    const snapshot = `${Math.round(stats.lastSnapshotBytes / 1024)}KB snap`;
    const backlog = `${Math.round(stats.backlogBytes / 1024)}KB queued`;
    const drops = stats.role === 'host' ? `drop ${stats.droppedSnapshots} coal ${stats.coalescedSnapshots}` : `pending ${stats.pendingInputs ?? 0}`;
    const prediction = smoothing ? `pred ${formatMeters(smoothing.predictionErrorEwma)}/${formatMeters(smoothing.predictionErrorMax)}` : 'pred --';
    const extrapolation = smoothing ? `extrap ${smoothing.remoteExtrapolationEvents}/${smoothing.remoteExtrapolationSeconds.toFixed(2)}s` : 'extrap --';
    this.networkLine.textContent = `net ${stats.role} · ${relay} · ${rtt} · ${rate} · ${snapshot} · ${backlog} · ${drops} · ${prediction} · ${extrapolation}`;
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
    const parsed = parseWorkbenchDocumentJson(this.rulesJsonInput.value);
    this.editableRuleset = parsed.ruleset;
    this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
    if (parsed.editor) {
      this.workbenchState = createWorkbenchState(this.editableRuleset, parsed.editor);
    } else {
      updateWorkbenchDraft(this.workbenchState, this.editableRuleset);
    }
    void this.refreshRulesInspector();
    return this.editableRuleset;
  }

  private handleWorkbenchTabClick(event: Event): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-workbench-tab]');
    if (!button) {
      return;
    }
    if (button.dataset.workbenchTab && isWorkbenchTab(button.dataset.workbenchTab)) {
      this.selectWorkbenchTab(button.dataset.workbenchTab);
    }
  }

  private selectWorkbenchTab(tab: WorkbenchTab): void {
    this.workbenchState.selectedTab = tab;
    this.syncWorkbenchControls();
  }

  private handleWorkbenchTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(this.workbenchTabsRoot.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]'));
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current < 0) {
      return;
    }
    let nextIndex: number;
    if (event.key === 'ArrowRight') {
      nextIndex = (current + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (current - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else if (event.key === 'Enter' || event.key === ' ') {
      const tab = tabs[current]?.dataset.workbenchTab;
      if (tab && isWorkbenchTab(tab)) {
        event.preventDefault();
        this.selectWorkbenchTab(tab);
      }
      return;
    } else {
      return;
    }
    event.preventDefault();
    const tab = tabs[nextIndex];
    const tabId = tab?.dataset.workbenchTab;
    if (tab && tabId && isWorkbenchTab(tabId)) {
      tab.focus();
      this.selectWorkbenchTab(tabId);
    }
  }

  private handleWorkbenchDiagnosticClick(event: Event): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-diagnostic-path]');
    const path = button?.dataset.diagnosticPath;
    if (!path) {
      return;
    }
    const control = this.findWorkbenchControlForPath(path);
    if (control) {
      const panel = control.closest<HTMLElement>('[data-workbench-panel]');
      const tab = panel?.dataset.workbenchPanel;
      if (tab && isWorkbenchTab(tab)) {
        this.selectWorkbenchTab(tab);
      }
      requestAnimationFrame(() => control.focus());
    }
  }

  private async handleWorkbenchInput(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    if (target.id === 'rules-json') {
      return;
    }
    if (target.dataset.prefField) {
      this.updatePreferenceFromControl(target);
      return;
    }
    if (target.dataset.abilitySelect === 'true') {
      this.workbenchState.selectedAbilityId = target.value;
      this.syncWorkbenchControls();
      return;
    }
    if (target.dataset.triggerSelect === 'true') {
      this.workbenchState.selectedTriggerId = target.value;
      this.syncWorkbenchControls();
      return;
    }
    if (target.dataset.npcSelect === 'true') {
      this.workbenchState.selectedNpcId = target.value;
      this.syncWorkbenchControls();
      return;
    }

    const next = structuredClone(this.editableRuleset) as Ruleset;
    const edit = workbenchEditFromControl(target);
    if (!edit) {
      return;
    }
    if (!applyWorkbenchFieldEdit(next, this.workbenchState, edit)) {
      return;
    }
    await this.commitWorkbenchRules(next, workbenchFieldPath(edit, this.workbenchState));
  }

  private updatePreferenceFromControl(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const field = target.dataset.prefField as keyof UiPreferences | undefined;
    if (!field) {
      return;
    }
    const next = { ...this.uiPreferences };
    if (field === 'traceDefaultOpen' && target instanceof HTMLInputElement) {
      next.traceDefaultOpen = target.checked;
    } else if (field === 'skillBarPosition' || field === 'touchHandedness' || field === 'hudDensity') {
      next[field] = target.value as never;
    } else {
      const value = readControlNumber(target);
      if (value === undefined) {
        return;
      }
      next[field] = value as never;
    }
    this.uiPreferences = next;
    saveUiPreferences(this.uiPreferences);
    this.applyUiPreferences();
    this.syncWorkbenchControls();
  }

  private async commitWorkbenchRules(nextRuleset: Ruleset, path?: string): Promise<void> {
    try {
      this.editableRuleset = validateRuleset(nextRuleset);
      updateWorkbenchDraft(this.workbenchState, this.editableRuleset);
      this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
      this.workbenchDiagnostics = [];
      await this.refreshRulesInspector();
      this.syncWorkbenchControls();
    } catch (error) {
      this.workbenchDiagnostics = diagnosticsFromError(error).map((diagnostic) => ({
        ...diagnostic,
        path: diagnostic.path === '$' ? path ?? diagnostic.path : diagnostic.path,
      }));
      this.renderWorkbenchDiagnostics();
      this.log(`workbench rejected: ${readError(error)}`);
      this.syncWorkbenchControls();
    }
  }

  private syncWorkbenchControls(): void {
    if (!this.workbenchView) {
      return;
    }
    const ruleset = this.editableRuleset;
    ensureWorkbenchSelections(this.workbenchState, ruleset);

    for (const button of this.workbenchTabsRoot.querySelectorAll<HTMLButtonElement>('[data-workbench-tab]')) {
      const active = button.dataset.workbenchTab === this.workbenchState.selectedTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.workbenchPanelsRoot.querySelectorAll<HTMLElement>('[data-workbench-panel]')) {
      panel.hidden = panel.dataset.workbenchPanel !== this.workbenchState.selectedTab;
    }

    setControlValue(this.workbenchView, '#workbench-rule-name', ruleset.name);
    setControlValue(this.workbenchView, '#workbench-duration', String(Math.round(ruleset.match.durationTicks / ruleset.tickRate)));
    setControlValue(this.workbenchView, '#workbench-score-limit', String(ruleset.match.scoreLimit));
    setControlChecked(this.workbenchView, '#workbench-friendly-fire', ruleset.match.friendlyFire);
    setControlValue(this.workbenchView, '#workbench-objective-radius', String(ruleset.objectives[0]?.scoreZones[0]?.radius ?? 1));
    setControlValue(this.workbenchView, '#workbench-objective-points', String(ruleset.objectives[0]?.scoreZones[0]?.points ?? 1));

    setControlValue(this.workbenchView, '#workbench-movement-mode', ruleset.player.movement.mode);
    setControlValue(this.workbenchView, '#workbench-aim-mode', ruleset.player.aim.mode);
    setControlValue(this.workbenchView, '#workbench-player-speed', String(ruleset.player.speed));
    setControlValue(this.workbenchView, '#workbench-player-damping', String(ruleset.player.damping));
    setControlValue(this.workbenchView, '#workbench-player-hp', String(ruleset.player.maxHp));
    setControlValue(this.workbenchView, '#workbench-tank-turn', String(ruleset.player.movement.turnSpeedDegrees));
    setControlValue(this.workbenchView, '#workbench-tank-reverse', String(ruleset.player.movement.reverseMultiplier));
    setControlValue(this.workbenchView, '#workbench-platform-gravity', String(ruleset.player.movement.platform.gravity));
    setControlValue(this.workbenchView, '#workbench-platform-jump', String(ruleset.player.movement.platform.jumpVelocity));
    setControlValue(this.workbenchView, '#workbench-platform-air', String(ruleset.player.movement.platform.airControl));
    setControlValue(this.workbenchView, '#workbench-platform-fall', String(ruleset.player.movement.platform.maxFallSpeed));
    setControlValue(this.workbenchView, '#workbench-platform-probe', String(ruleset.player.movement.platform.groundProbeDistance));

    const abilityOptions = ruleset.abilities.map((ability) => ({ value: ability.id, label: ability.name }));
    setSelectOptions(this.workbenchView, '#workbench-ability-select', abilityOptions, this.workbenchState.selectedAbilityId);
    for (const select of this.workbenchView.querySelectorAll<HTMLSelectElement>('[data-loadout-slot]')) {
      const slot = Number(select.dataset.loadoutSlot);
      replaceOptions(select, abilityOptions, ruleset.loadout.abilityIds[slot] ?? '');
    }
    const ability = ruleset.abilities.find((candidate) => candidate.id === this.workbenchState.selectedAbilityId);
    if (ability) {
      setControlValue(this.workbenchView, '#workbench-ability-damage', String(ability.damage));
      setControlValue(this.workbenchView, '#workbench-ability-cooldown', String(ability.cooldownTicks));
      setControlValue(this.workbenchView, '#workbench-ability-range', String(ability.range));
      setControlValue(this.workbenchView, '#workbench-ability-radius', String(ability.radius));
      setControlValue(this.workbenchView, '#workbench-ability-targeting', ability.targeting);
      setControlValue(this.workbenchView, '#workbench-ability-color', ability.color);
    }

    const triggerOptions = ruleset.mechanics.triggers.map((trigger) => ({ value: trigger.id, label: trigger.name ?? trigger.id }));
    setSelectOptions(this.workbenchView, '#workbench-trigger-select', triggerOptions, this.workbenchState.selectedTriggerId);
    const trigger = ruleset.mechanics.triggers.find((candidate) => candidate.id === this.workbenchState.selectedTriggerId);
    if (trigger) {
      setControlValue(this.workbenchView, '#workbench-trigger-name', trigger.name ?? trigger.id);
      setControlValue(this.workbenchView, '#workbench-trigger-event', trigger.event);
      const action = trigger.actions.find((candidate) => 'amount' in candidate);
      setControlValue(this.workbenchView, '#workbench-trigger-amount', action && 'amount' in action ? String(action.amount) : '');
    }
    const mechanicsFlow = this.workbenchView.querySelector<HTMLElement>('#workbench-mechanics-flow');
    if (mechanicsFlow) {
      mechanicsFlow.innerHTML = mechanicsFlowHtml(ruleset);
    }

    const npcOptions = ruleset.npcs.archetypes.map((npc) => ({ value: npc.id, label: npc.name }));
    setSelectOptions(this.workbenchView, '#workbench-npc-select', npcOptions, this.workbenchState.selectedNpcId);
    const npc = ruleset.npcs.archetypes.find((candidate) => candidate.id === this.workbenchState.selectedNpcId);
    if (npc) {
      setControlValue(this.workbenchView, '#workbench-npc-behavior', npc.behavior.mode);
      setControlValue(this.workbenchView, '#workbench-npc-aggro', String(npc.behavior.aggroRange));
      setControlValue(this.workbenchView, '#workbench-npc-speed', String(npc.speedMultiplier));
      setControlChecked(this.workbenchView, '#workbench-npc-session', ruleset.npcs.sessionSpawns.some((spawn) => spawn.archetypeId === npc.id));
    }

    const anchorBody = ruleset.abilities
      .find((candidate) => candidate.id === 'anchor-orb')
      ?.effects?.find((effect) => effect.kind === 'spawnBody');
    if (anchorBody?.kind === 'spawnBody') {
      setControlValue(this.workbenchView, '#workbench-anchor-mass', String(anchorBody.body.mass));
      setControlValue(this.workbenchView, '#workbench-anchor-lifetime', String(anchorBody.body.lifetimeTicks));
    }

    setControlValue(this.workbenchView, '#pref-hud-scale', String(this.uiPreferences.hudScale));
    setControlValue(this.workbenchView, '#pref-skill-position', this.uiPreferences.skillBarPosition);
    setControlValue(this.workbenchView, '#pref-touch-handedness', this.uiPreferences.touchHandedness);
    setControlValue(this.workbenchView, '#pref-touch-scale', String(this.uiPreferences.touchScale));
    setControlValue(this.workbenchView, '#pref-touch-opacity', String(this.uiPreferences.touchOpacity));
    setControlChecked(this.workbenchView, '#pref-trace-open', this.uiPreferences.traceDefaultOpen);
    setControlValue(this.workbenchView, '#pref-hud-density', this.uiPreferences.hudDensity);
    this.renderWorkbenchDiagnostics();
  }

  private renderWorkbenchDiagnostics(): void {
    if (!this.workbenchDiagnosticsRoot) {
      return;
    }
    if (this.workbenchDiagnostics.length === 0) {
      this.workbenchDiagnosticsRoot.innerHTML = '<div class="workbench-diagnostics__ok">No validation issues</div>';
      return;
    }
    this.workbenchDiagnosticsRoot.innerHTML = this.workbenchDiagnostics
      .map(
        (diagnostic) => `
          <button class="workbench-diagnostic workbench-diagnostic--${diagnostic.severity}" type="button" data-diagnostic-path="${escapeHtml(diagnostic.path)}">
            <strong>${escapeHtml(diagnostic.path)}</strong>
            <span>${escapeHtml(diagnostic.message)}</span>
          </button>
        `,
      )
      .join('');
  }

  private findWorkbenchControlForPath(path: string): HTMLElement | undefined {
    const controls = Array.from(this.workbenchView.querySelectorAll<HTMLElement>('[data-workbench-path]'));
    return (
      controls.find((control) => control.dataset.workbenchPath === path) ??
      controls.find((control) => path.startsWith(control.dataset.workbenchPath ?? '')) ??
      controls.find((control) => (control.dataset.workbenchPath ?? '').startsWith(path))
    );
  }

  private applyUiPreferences(): void {
    const shell = this.root.querySelector<HTMLElement>('.app-shell');
    if (!shell) {
      return;
    }
    shell.style.setProperty('--hud-scale', String(this.uiPreferences.hudScale));
    shell.style.setProperty('--touch-scale', String(this.uiPreferences.touchScale));
    shell.style.setProperty('--touch-opacity', String(this.uiPreferences.touchOpacity));
    shell.dataset.skillBarPosition = this.uiPreferences.skillBarPosition;
    shell.dataset.touchHandedness = this.uiPreferences.touchHandedness;
    shell.dataset.hudDensity = this.uiPreferences.hudDensity;
    const log = this.root.querySelector<HTMLDetailsElement>('#arena-log');
    if (log) {
      log.open = this.uiPreferences.traceDefaultOpen;
    }
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
    if (this.mode === 'client' && this.snapshotSmoother) {
      this.snapshotSmoother.pushAuthoritative(snapshot);
      this.smoothingStats = this.snapshotSmoother.stats();
    }
    const presentationSnapshot =
      this.mode === 'client' ? (this.snapshotSmoother?.render(performance.now(), this.clientSession?.pendingInputs() ?? []) ?? snapshot) : snapshot;
    this.lastSnapshot = presentationSnapshot;
    window.__BEAT_SNAPSHOT__ = presentationSnapshot;
    window.__BEAT_RENDER_SNAPSHOT__ = presentationSnapshot;
    window.__BEAT_TRACE__ = snapshot.mechanicTraces;
    window.__BEAT_AI_TRACE__ = snapshot.aiTraces;
    this.renderer.update(presentationSnapshot);
    this.updateAimOrigin(presentationSnapshot);
    this.updateSkillBar(presentationSnapshot);
    this.updateLocalMechanics(presentationSnapshot);
    this.updateMatchHud(presentationSnapshot);
    this.renderTrace(snapshot.mechanicTraces, snapshot.aiTraces);
    this.setStatus(status);
    this.updateNetworkLine();
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
    this.engine?.resetObjectives();
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
    updateWorkbenchDraft(this.workbenchState, this.editableRuleset);
    this.workbenchDiagnostics = [];
    this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
    await this.refreshRulesHash();
    this.syncWorkbenchControls();
    this.log('rules reset to default preset');
  }

  private async applyRulesJson(): Promise<void> {
    try {
      const parsed = parseWorkbenchDocumentJson(this.rulesJsonInput.value);
      this.editableRuleset = parsed.ruleset;
      this.workbenchState = createWorkbenchState(this.editableRuleset, parsed.editor);
      this.workbenchDiagnostics = [];
      this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
      await this.refreshRulesHash();
      this.syncWorkbenchControls();
      this.log(`rules applied: ${this.editableRuleset.name}`);
    } catch (error) {
      this.workbenchDiagnostics = diagnosticsFromError(error);
      this.renderWorkbenchDiagnostics();
      this.log(`rules rejected: ${readError(error)}`);
    }
  }

  private async copyRulesJson(): Promise<void> {
    const json = stringifyRulesDocument(parseWorkbenchDocumentJson(this.rulesJsonInput.value).ruleset);
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
      const { ruleset } = parseWorkbenchDocumentJson(this.rulesJsonInput.value);
      const hash = await hashRuleset(ruleset);
      if (refreshId !== this.rulesInspectorRefreshId) {
        return;
      }
      this.editableRuleset = ruleset;
      updateWorkbenchDraft(this.workbenchState, ruleset);
      this.editableRulesetHash = hash;
      this.rulesHashLine.textContent = `${ruleset.name} · ${shortHash(hash)}`;
      this.rulesValidationLine.textContent = `valid · ${ruleset.abilities.length} abilities · ${ruleset.objectives.length} objectives · ${ruleset.mechanics.statuses.length} statuses · ${ruleset.mechanics.triggers.length} triggers · ${ruleset.npcs.archetypes.length} NPCs`;
      this.rulesValidationLine.classList.remove('is-error');
      this.rulesInspector.innerHTML = rulesInspectorHtml(ruleset);
      this.workbenchDiagnostics = [];
      this.renderWorkbenchDiagnostics();
      this.syncWorkbenchControls();
      this.syncLabControls();
    } catch (error) {
      if (refreshId !== this.rulesInspectorRefreshId) {
        return;
      }
      this.rulesValidationLine.textContent = `invalid · ${readError(error)}`;
      this.rulesValidationLine.classList.add('is-error');
      this.rulesInspector.innerHTML = '<div class="inspector-empty">Invalid JSON</div>';
      this.workbenchDiagnostics = diagnosticsFromError(error);
      this.renderWorkbenchDiagnostics();
    }
  }

  private async insertRulesExample(example: string): Promise<void> {
    try {
      const ruleset = parseWorkbenchDocumentJson(this.rulesJsonInput.value).ruleset;
      const nextRuleset = applyRulesExample(ruleset, example);
      this.editableRuleset = validateRuleset(nextRuleset);
      updateWorkbenchDraft(this.workbenchState, this.editableRuleset);
      this.workbenchDiagnostics = [];
      this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
      await this.refreshRulesInspector();
      this.syncWorkbenchControls();
      this.log(`rules example applied: ${example}`);
    } catch (error) {
      this.workbenchDiagnostics = diagnosticsFromError(error);
      this.renderWorkbenchDiagnostics();
      this.log(`rules example rejected: ${readError(error)}`);
    }
  }

  private showMenu(): void {
    this.menuView.hidden = false;
    this.workbenchView.hidden = true;
    this.arenaView.hidden = true;
    this.syncLabControls();
  }

  private showWorkbench(): void {
    blurActiveElement();
    this.menuView.hidden = true;
    this.workbenchView.hidden = false;
    this.arenaView.hidden = true;
    this.setRulesLocked(false);
    this.syncWorkbenchControls();
    void this.refreshRulesInspector();
  }

  private showArena(): void {
    blurActiveElement();
    this.menuView.hidden = true;
    this.workbenchView.hidden = true;
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
    for (const control of this.workbenchView.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      'input, select, textarea, button',
    )) {
      if (control.id !== 'workbench-back-menu') {
        control.disabled = locked;
      }
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

  private updateMatchHud(snapshot: EngineSnapshot | undefined): void {
    if (!snapshot) {
      this.matchLine.textContent = 'match idle';
      return;
    }
    const seconds = Math.ceil(snapshot.match.remainingTicks / (this.ruleset?.tickRate ?? 30));
    const scores = snapshot.match.teams.map((team) => `${team.name} ${team.score}`).join(' · ');
    const winner = snapshot.match.winnerTeamId ? snapshot.match.teams.find((team) => team.id === snapshot.match.winnerTeamId)?.name : undefined;
    this.matchLine.textContent = snapshot.match.finished
      ? `${winner ? `${winner} wins` : 'draw'} · ${scores}`
      : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${scores}`;
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
              <button id="open-workbench" class="button" type="button">Workbench</button>
            </div>
            <div id="menu-status-line" class="menu-status">starting</div>
            <section class="room-section">
              <h2>Rooms</h2>
              <div id="room-list" class="room-list"></div>
            </section>
          </section>
        </div>
      </section>

      ${workbenchHtml()}
      <section id="arena-view" class="arena-view" hidden>
        <canvas id="arena" class="arena" aria-label="Beat arena"></canvas>
        <div class="hud">
          <div id="status-line">starting</div>
          <div id="match-line">match idle</div>
          <div id="hash-line">rules idle</div>
          <div id="peer-line">peer</div>
          <div id="network-line">net idle</div>
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
        <details id="arena-log" class="arena-log">
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

function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function readControlNumber(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): number | undefined {
  const value = Number(target.value);
  return Number.isFinite(value) ? value : undefined;
}

function setControlValue(root: ParentNode, selector: string, value: string): void {
  const control = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (control && control.value !== value) {
    control.value = value;
  }
}

function setControlChecked(root: ParentNode, selector: string, checked: boolean): void {
  const control = root.querySelector<HTMLInputElement>(selector);
  if (control) {
    control.checked = checked;
  }
}

function setSelectOptions(root: ParentNode, selector: string, options: Array<{ value: string; label: string }>, selected: string): void {
  const select = root.querySelector<HTMLSelectElement>(selector);
  if (select) {
    replaceOptions(select, options, selected);
  }
}

function replaceOptions(select: HTMLSelectElement, options: Array<{ value: string; label: string }>, selected: string): void {
  const previous = select.value;
  select.replaceChildren(
    ...options.map((option) => {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      return element;
    }),
  );
  select.value = options.some((option) => option.value === selected) ? selected : previous;
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
  if (example === 'platform-preset') {
    const preset = createDefaultRuleset();
    preset.id = 'beat-platform-lab';
    preset.name = 'Beat Platform Lab';
    preset.player.damping = 0.35;
    preset.player.speed = 7.2;
    preset.player.movement.mode = 'platform';
    preset.player.movement.platform = {
      gravity: 30,
      jumpVelocity: 12,
      airControl: 0.48,
      maxFallSpeed: 20,
      groundProbeDistance: 0.1,
    };
    preset.obstacles = [
      { id: 'floor-step-left', x: -8, y: 6.2, halfWidth: 5.2, halfHeight: 0.55 },
      { id: 'floor-step-right', x: 8, y: 6.2, halfWidth: 5.2, halfHeight: 0.55 },
      { id: 'mid-platform', x: 0, y: 1.7, halfWidth: 4.2, halfHeight: 0.42 },
      { id: 'high-platform', x: -8, y: -2.7, halfWidth: 3.4, halfHeight: 0.42 },
    ];
    preset.loadout.abilityIds = ['pulse-bolt', 'anchor-orb', 'seeker-spark', 'ion-lance'];
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
