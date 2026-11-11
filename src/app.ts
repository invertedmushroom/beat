import { createDefaultRuleset, defaultObjectiveForKind } from './engine/defaultRules';
import { EngineClient } from './engine/EngineClient';
import { hashRuleset, rulesetFingerprint } from './engine/rulesHash';
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
import { detectCapabilities, type InputCapabilities } from './input/capabilities';
import { InputController, type TouchControlElements } from './input/InputController';
import { PointerWorldAdapter } from './input/PointerWorldAdapter';
import { adaptProfileToRules, BUILTIN_PROFILE_IDS, type UiProfileId } from './input/profiles';
import { getControlProfileOptions, getProfileBehavior, type OverrideKey } from './input/profileRegistry';
import { installTapFirePointerGesture } from './input/tapFirePointerGesture';
import { SnapshotSmoother, type SnapshotSmoothingStats } from './net/snapshotSmoothing';
import { HostSession, ClientSession, type NetDiagnostics } from './net/webrtc';
import { CanvasRenderer } from './render/CanvasRenderer';
import type { RoomInfo } from './rooms/directory';
import { createRoomDirectory } from './rooms/directoryFactory';
import {
  defaultUiPreferences,
  defaultUiPreferencesV2,
  loadUiPreferences,
  loadUiPreferencesV2,
  resolveActiveProfileId,
  saveUiPreferences,
  saveUiPreferencesV2,
  type UiPreferences,
  type UiPreferencesV2,
} from './ui/preferences';
import {
  applyWorkbenchCommand,
  applyWorkbenchFieldEdit,
  diagnosticsFromError,
  workbenchCommandFromButton,
  workbenchCommandPath,
  workbenchEditFromControl,
  workbenchFieldPath,
  type WorkbenchDiagnostic,
} from './ui/workbench/fields';
import { escapeHtml, formatMeters, aiTraceLabel, mechanicsChipHtml, mechanicsFlowHtml, rulesInspectorHtml, traceLabel } from './ui/workbench/inspector';
import { parseWorkbenchDocumentJson, stringifyRulesDocument } from './ui/workbench/jsonSync';
import { abilityEffectsHtml, matchObjectivesHtml, mechanicsChainHtml, mechanicsPresetsHtml } from './ui/workbench/sections';
import {
  createWorkbenchState,
  ensureWorkbenchSelections,
  isWorkbenchTab,
  updateWorkbenchDraft,
  type WorkbenchState,
  type WorkbenchTab,
} from './ui/workbench/state';
import { workbenchHtml } from './ui/workbench/view';
import {
  MATCH_KITS,
  MOVEMENT_CHASSIS,
  compileKit,
  createExperimentSelection,
  createKitSelection,
  withExperimentSelection,
  withMovementPackage,
  type KitSelection,
} from './ui/workbench/kits';
import { kitSelectionFromControl, selectLibraryGroup, syncKitControls } from './ui/workbench/kitsView';
import { applyExperiment, isExperimentAddonId, isMechanicPresetId, toggleMechanicPreset } from './ui/workbench/experiments';
import { configurationSummary } from './ui/workbench/configurationView';
import { abilityInspectorHtml } from './ui/workbench/abilityView';
import { syncMovementPackages } from './ui/workbench/movementView';
import { createId } from './utils/ids';
import { shortHash } from './utils/hash';
import { ReplayFeature } from './ui/ReplayFeature';
import type { ReplayClip } from './replay/archive';
import { PwaSession, deviceSessionHtml } from './pwa';

const ROOM_STALE_MS = 5_000;
const PEER_ID_STORAGE_KEY = 'beat:peer-id:v1';
const ACTIVE_CLIENT_SESSION_KEY = 'beat:active-client-session:v1';
const ACTIVE_CLIENT_SESSION_TTL_MS = 10 * 60_000;

type Mode = 'idle' | 'solo' | 'lab' | 'host' | 'client' | 'replay';

type StoredActiveClientSession = {
  roomId: string;
  savedAt: number;
};

export class BeatApp {
  private readonly directoryRuntime = createRoomDirectory();
  private readonly directory = this.directoryRuntime.directory;
  private readonly peerId = loadSessionPeerId();
  private readonly handleFullscreenChange = () => this.syncFullscreenButton();
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.refreshRoomsNow();
    }
  };
  private readonly handlePageShow = () => {
    void this.refreshRoomsNow();
  };
  private readonly handleWindowFocus = () => {
    void this.refreshRoomsNow();
  };
  private readonly beforeUnloadHandler = () => {
    this.hostSession?.destroy();
  };
  private readonly renderer: CanvasRenderer;
  private readonly replays: ReplayFeature;
  private readonly pwa: PwaSession;
  private readonly input: InputController;
  private readonly pointerWorld: PointerWorldAdapter;
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
  private refreshRoomsButton!: HTMLButtonElement;
  private roomList!: HTMLDivElement;
  private roomSummary!: HTMLDivElement;
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
  private labControlsRoot!: HTMLDetailsElement;
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
  private skillButtons!: HTMLButtonElement[];
  private canvas!: HTMLCanvasElement;
  private controlProfileSelect!: HTMLSelectElement;
  private arenaHintEl!: HTMLDivElement;
  private fullscreenButtons: HTMLButtonElement[] = [];
  private engine?: EngineClient;
  private hostSession?: HostSession;
  private clientSession?: ClientSession;
  private localPlayerId?: string;
  private ruleset?: Ruleset;
  private unsubscribeRooms?: () => void;
  private unsubscribeInput?: () => void;
  private unsubscribeSnapshot?: () => void;
  private currentRooms: RoomInfo[] = [];
  private lastSnapshot?: EngineSnapshot;
  private snapshotSmoother?: SnapshotSmoother;
  private networkStats?: NetDiagnostics;
  private smoothingStats?: SnapshotSmoothingStats;
  private previousSlotCooldowns?: number[];
  private editableRuleset: Ruleset = createDefaultRuleset();
  private editableRulesetHash = '';
  private rulesInspectorRefreshId = 0;
  private uiPreferences: UiPreferences = defaultUiPreferences();
  private uiPreferencesV2: UiPreferencesV2 = defaultUiPreferencesV2();
  private readonly capabilities: InputCapabilities = detectCapabilities();
  private activeControlProfile: UiProfileId = 'desktop-kbm';
  private tapMoveTarget?: { x: number; y: number };
  private pendingTapFire?: { worldX: number; worldY: number };
  private penHoverWorld?: { x: number; y: number };
  private unsubscribePointerWorld?: () => void;
  private consecutiveStuckTicks = 0;
  private arenaHintTimer?: number;
  private workbenchState: WorkbenchState = createWorkbenchState(this.editableRuleset);
  private kitDraft?: { selection: KitSelection; fingerprint: string } = {
    selection: createExperimentSelection('combo-preset'),
    fingerprint: rulesetFingerprint(this.editableRuleset),
  };
  private workbenchDiagnostics: WorkbenchDiagnostic[] = [];
  private labActorIds = new Set<string>();
  private labSpawnIndex = 0;
  private labPaused = false;
  private restoringClientSession = false;

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = shellHtml();
    this.bindDom();
    this.pwa = new PwaSession(this.root, () => this.mode === 'idle' && this.workbenchView.hidden ? undefined : 'Return to the menu before updating. Updating a host ends its room.');
    this.uiPreferences = loadUiPreferences();
    this.uiPreferencesV2 = loadUiPreferencesV2();
    // Persist v2 immediately so the v1→v2 migration sticks even if the user
    // never explicitly edits preferences again.
    saveUiPreferencesV2(this.uiPreferencesV2);
    this.renderer = new CanvasRenderer(this.canvas);
    this.input = new InputController(this.canvas, this.touchControls());
    this.replays = new ReplayFeature(this.root, (clip) => this.watchReplay(clip));
    this.pointerWorld = new PointerWorldAdapter({
      target: this.canvas,
      clientToWorld: (clientX, clientY) => this.renderer.clientToWorld(clientX, clientY),
      pickActorAtClient: (clientX, clientY) => this.renderer.pickActorAtClient(clientX, clientY),
    });
    this.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas.addEventListener('pointerleave', this.onCanvasPointerLeave);
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDownForHover);
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
    this.workbenchButton.addEventListener('click', () => {
      this.selectWorkbenchTab('kits');
      this.showWorkbench();
    });
    this.workbenchBackButton.addEventListener('click', () => this.showMenu());
    this.leaveButton.addEventListener('click', () => this.stopActiveMode());
    this.controlProfileSelect.addEventListener('change', () => this.handleControlProfileChange());
    this.refreshRoomsButton.addEventListener('click', () => void this.refreshRoomsNow());
    for (const button of this.fullscreenButtons) {
      button.addEventListener('click', () => void this.toggleFullscreen());
    }
    this.labSpawnButton.addEventListener('click', () => this.spawnSelectedLabActor());
    this.labClearActorsButton.addEventListener('click', () => this.clearLabActors());
    this.labResetButton.addEventListener('click', () => this.resetLabActors());
    this.labClearTraceButton.addEventListener('click', () => this.clearLabTrace());
    this.labPauseButton.addEventListener('click', () => this.toggleLabPause());
    this.resetRulesButton.addEventListener('click', () => void this.resetRules());
    this.applyRulesButton.addEventListener('click', () => void this.applyRulesJson());
    this.copyRulesButton.addEventListener('click', () => void this.copyRulesJson());
    this.rulesJsonInput.addEventListener('input', () => {
      this.kitDraft = undefined;
      this.syncWorkbenchControls();
      void this.refreshRulesInspector();
    });
    this.workbenchTabsRoot.addEventListener('click', (event) => this.handleWorkbenchTabClick(event));
    this.workbenchTabsRoot.addEventListener('keydown', (event) => this.handleWorkbenchTabKeydown(event));
    this.workbenchDiagnosticsRoot.addEventListener('click', (event) => this.handleWorkbenchDiagnosticClick(event));
    this.workbenchView.addEventListener('input', (event) => void this.handleWorkbenchInput(event));
    this.workbenchView.addEventListener('change', (event) => void this.handleWorkbenchInput(event));
    this.workbenchView.addEventListener('click', (event) => void this.handleWorkbenchCommand(event));
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('focus', this.handleWindowFocus);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.rulesJsonInput.value = stringifyRulesDocument(this.editableRuleset);
    this.syncWorkbenchControls();
    void this.refreshRulesInspector();
    this.syncFullscreenButton();
    this.showMenu();
    this.setStatus('idle: local directory ready');
    this.hashLine.textContent = this.directoryRuntime.label;
    this.peerLine.textContent = `peer ${shortHash(this.peerId)}`;
    void this.refreshRoomsNow();
    this.pwa.start();
  }

  destroy(): void {
    this.pwa.destroy();
    this.stopActiveMode();
    this.unsubscribeRooms?.();
    this.unsubscribeInput?.();
    this.unsubscribePointerWorld?.();
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('focus', this.handleWindowFocus);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    this.pointerWorld.destroy();
    this.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onCanvasPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDownForHover);
    this.input.destroy();
    this.renderer.destroy();
    this.replays.destroy();
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
    this.refreshRoomsButton = requireNode<HTMLButtonElement>('#refresh-rooms');
    this.roomList = requireNode<HTMLDivElement>('#room-list');
    this.roomSummary = requireNode<HTMLDivElement>('#room-summary');
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
    this.labControlsRoot = requireNode<HTMLDetailsElement>('#lab-controls');
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
    this.fullscreenButtons = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.fullscreen-toggle-button'));
    this.resetRulesButton = requireNode<HTMLButtonElement>('#reset-rules');
    this.applyRulesButton = requireNode<HTMLButtonElement>('#apply-rules');
    this.copyRulesButton = requireNode<HTMLButtonElement>('#copy-rules');
    this.skillButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.skill-slot'));
    if (this.skillButtons.length !== 4) {
      throw new Error('missing skill slots');
    }
    this.canvas = requireNode<HTMLCanvasElement>('#arena');
    this.controlProfileSelect = requireNode<HTMLSelectElement>('#control-profile-select');
    this.arenaHintEl = requireNode<HTMLDivElement>('#arena-hint');
  }

  private async hostRoom(): Promise<void> {
    const selectedRuleset = this.readRulesForStart();
    if (!selectedRuleset) {
      return;
    }
    this.stopActiveMode();
    this.mode = 'host';
    this.ruleset = selectedRuleset;
    this.applyUiPreferences();
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
    this.applyUiPreferences();
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

  private async joinRoom(room: RoomInfo, options: { allowReservedSlot?: boolean } = {}): Promise<void> {
    const rooms = await this.refreshRoomsNow();
    if (this.pwa.applyingUpdate) return;
    const liveRoom = rooms.find((candidate) => candidate.roomId === room.roomId);
    const stale = roomIsStale(liveRoom);
    const reservedSlot = Boolean(options.allowReservedSlot);
    const unavailable =
      !liveRoom ||
      liveRoom.status === 'closed' ||
      stale ||
      (!reservedSlot && !roomHasOpenSlot(liveRoom));
    if (unavailable) {
      this.log(`join blocked: ${room.name} is unavailable${stale ? ' (stale)' : ''}`);
      this.setStatus(`room unavailable: ${room.name}`);
      return;
    }
    room = liveRoom;
    this.stopActiveMode();
    this.mode = 'client';
    this.storeActiveClientSession(room.roomId);
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
      this.input.start(ruleset.tickRate);
      this.applyUiPreferences();
      this.snapshotSmoother?.destroy();
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
    const adjusted = this.applyProfileOverrides(input);
    if (this.mode === 'host' || this.mode === 'solo' || this.mode === 'lab') {
      this.engine?.submitInput(this.localPlayerId, adjusted);
      return;
    }
    if (this.mode === 'client') {
      this.clientSession?.submitInput(adjusted);
    }
  }

  /**
   * Runs the override pipeline declared by the active profile in
   * {@link getProfileBehavior}. Override order matches the array order in
   * the registry; current behaviour is movement-first then aim/fire so a
   * profile composing both (e.g. `tank-single-tap`) lets steering and
   * one-shot fire coexist without re-stomping each other's fields.
   *
   * Profiles with no overrides return the input unchanged. The per-override
   * state (tap target, pending fire, stuck-tick counter) is still owned by
   * `App`; this method is just the dispatcher.
   */
  private applyProfileOverrides(input: PlayerInput): PlayerInput {
    const behavior = getProfileBehavior(this.activeControlProfile);
    if (behavior.overrides.length === 0) {
      // Keep stuck-tick counter quiet when no profile owns it.
      this.consecutiveStuckTicks = 0;
      return input;
    }
    let current = input;
    for (const key of behavior.overrides) {
      current = this.runOverride(key, current);
    }
    return current;
  }

  private runOverride(key: OverrideKey, input: PlayerInput): PlayerInput {
    switch (key) {
      case 'single-stick-tank':
        return this.applySingleStickTankOverride(input);
      case 'tap-move':
        return this.applyTapMoveOverride(input);
      case 'tap-fire':
        return this.applyTapFireOverride(input);
    }
  }

  /**
   * Computes single-stick auto-steering: forward half of the stick drives
   * forward and steers towards the stick vector; reverse half drives backward
   * and steers the rear towards the stick. Caller is responsible for ensuring
   * the active profile actually wants this override (registry decides).
   */
  private applySingleStickTankOverride(input: PlayerInput): PlayerInput {
    const renderSnapshot = window.__BEAT_RENDER_SNAPSHOT__;
    const player = renderSnapshot?.players.find((p) => p.playerId === this.localPlayerId)
                   ?? this.lastSnapshot?.players.find((p) => p.playerId === this.localPlayerId);
    if (!player) {
      return input;
    }

    const stick = this.input.getTouchMove();
    const stickDist = Math.hypot(stick.x, stick.y);
    if (stickDist < 0.05) {
      return input;
    }

    const tankAngle = Math.atan2(player.facingDy, player.facingDx);
    const stickAngle = Math.atan2(stick.y, stick.x);

    let diff = stickAngle - tankAngle;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;

    const rules = this.ruleset ?? this.editableRuleset;
    const turnSpeedDegrees = rules?.player.movement.turnSpeedDegrees ?? 180;
    const tickRate = rules?.tickRate ?? 30;
    const turnRadians = (turnSpeedDegrees * Math.PI) / 180 / tickRate;

    let moveX: number;
    let moveY: number;

    if (Math.abs(diff) <= Math.PI / 2) {
      // Forward half: steering rotates towards stick, throttle drives forward (negative Y)
      moveX = Math.min(1, Math.max(-1, diff / turnRadians));
      moveY = -stickDist;
    } else {
      // Reverse half: steering rotates rear towards stick, throttle drives backward (positive Y)
      let rearDiff = diff - Math.PI;
      while (rearDiff < -Math.PI) rearDiff += 2 * Math.PI;
      while (rearDiff > Math.PI) rearDiff -= 2 * Math.PI;

      moveX = Math.min(1, Math.max(-1, rearDiff / turnRadians));
      moveY = stickDist;
    }

    return { ...input, moveX, moveY };
  }

  /**
   * Overrides movement towards a stored world tap target. Caller (the override
   * dispatcher) only invokes this when the registry routes the active profile
   * to `'tap-move'`; this method assumes that and only checks for the target.
   */
  private applyTapMoveOverride(input: PlayerInput): PlayerInput {
    if (!this.tapMoveTarget) {
      this.consecutiveStuckTicks = 0;
      return input;
    }
    const renderSnapshot = window.__BEAT_RENDER_SNAPSHOT__;
    const player = renderSnapshot?.players.find((p) => p.playerId === this.localPlayerId)
                   ?? this.lastSnapshot?.players.find((p) => p.playerId === this.localPlayerId);
    if (!player) {
      return input;
    }
    const dx = this.tapMoveTarget.x - player.x;
    const dy = this.tapMoveTarget.y - player.y;
    const ARRIVAL_RADIUS = 0.4;

    const rules = this.ruleset ?? this.editableRuleset;
    if (rules?.player.movement.mode === 'platform' && Math.abs(dx) <= ARRIVAL_RADIUS && dy < -0.3) {
      this.tapMoveTarget = undefined;
      this.consecutiveStuckTicks = 0;
      return { ...input, moveX: 0, moveY: -1 };
    }

    const dist = Math.hypot(dx, dy);
    if (dist <= ARRIVAL_RADIUS) {
      this.tapMoveTarget = undefined;
      this.consecutiveStuckTicks = 0;
      return { ...input, moveX: 0, moveY: 0 };
    }
    if (rules?.player.movement.mode === 'platform') {
      const isStuckThisFrame = Math.abs(player.vx) < 0.15;
      if (isStuckThisFrame && Math.abs(dx) > ARRIVAL_RADIUS) {
        this.consecutiveStuckTicks += 1;
      } else {
        this.consecutiveStuckTicks = 0;
      }

      const isStuck = this.consecutiveStuckTicks > 8;
      const isClose = Math.abs(dx) < 1.5;
      const shouldJump = (dy < -0.8 && isClose) || isStuck;
      const moveX = Math.abs(dx) > ARRIVAL_RADIUS ? Math.sign(dx) : 0;
      const moveY = shouldJump ? -1 : 0;
      return { ...input, moveX, moveY };
    } else if (rules?.player.movement.mode === 'tank') {
      const targetAngle = Math.atan2(dy, dx);
      const currentAngle = Math.atan2(player.facingDy, player.facingDx);
      let diff = targetAngle - currentAngle;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;

      const turnSpeedDegrees = rules?.player.movement.turnSpeedDegrees ?? 180;
      const tickRate = rules?.tickRate ?? 30;
      const turnRadians = (turnSpeedDegrees * Math.PI) / 180 / tickRate;

      const moveX = Math.min(1, Math.max(-1, diff / turnRadians));
      const moveY = Math.abs(diff) > Math.PI / 3 ? 0 : -1;
      return { ...input, moveX, moveY };
    }

    return { ...input, moveX: dx / dist, moveY: dy / dist };
  }

  /**
   * Consumes a pending tap-fire intent: overrides aim toward the tap point
   * and queues a one-shot slot-0 cast (press+cast+release). Movement is left
   * untouched so composing with `single-stick-tank` (under
   * `tank-single-tap`) doesn't stomp steering. Caller's profile is already
   * known to want this override.
   */
  private applyTapFireOverride(input: PlayerInput): PlayerInput {
    if (!this.pendingTapFire) {
      return input;
    }
    const tap = this.pendingTapFire;
    this.pendingTapFire = undefined;
    const renderSnapshot = window.__BEAT_RENDER_SNAPSHOT__;
    const player = renderSnapshot?.players.find((p) => p.playerId === this.localPlayerId)
                   ?? this.lastSnapshot?.players.find((p) => p.playerId === this.localPlayerId);
    if (!player) {
      return input;
    }
    const dx = tap.worldX - player.x;
    const dy = tap.worldY - player.y;
    const dist = Math.hypot(dx, dy);
    const aimDx = dist > 0.001 ? dx / dist : input.aimDx;
    const aimDy = dist > 0.001 ? dy / dist : input.aimDy;

    // Set the aim in InputController so it persists!
    if (dist > 0.001) {
      this.input.setLastExplicitAim({ x: aimDx, y: aimDy });
    }

    return {
      ...input,
      aimDx,
      aimDy,
      castSlots: [...input.castSlots, 0],
      slotPresses: [...input.slotPresses, 0],
      slotReleases: [...input.slotReleases, 0],
    };
  }

  private getLocalPlayerAimOrigin(): { x: number; y: number } | undefined {
    const player = window.__BEAT_RENDER_SNAPSHOT__?.players.find((p) => p.playerId === this.localPlayerId)
                   ?? this.lastSnapshot?.players.find((p) => p.playerId === this.localPlayerId);
    if (!player) {
      return undefined;
    }
    return { x: player.x, y: player.y };
  }

  private stopActiveMode(): void {
    const wasReplay = this.mode === 'replay';
    this.replays.endSession();
    this.input.reset(Boolean(this.localPlayerId));
    this.tapMoveTarget = undefined;
    this.pendingTapFire = undefined;
    this.penHoverWorld = undefined;
    this.renderer.setAimGhost(undefined);
    this.hideArenaHint();
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
    this.snapshotSmoother?.destroy();
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
    this.arenaView.classList.remove('is-replay');
    if (wasReplay) this.input.start();
    this.setRulesLocked(false);
    this.applyUiPreferences();
    this.clearActiveClientSession();
    this.showMenu();
    this.setStatus(`idle: ${this.directoryRuntime.label}`);
  }

  private async refreshRoomsNow(): Promise<RoomInfo[]> {
    try {
      if (typeof this.directory.refreshRooms === 'function') {
        await Promise.resolve(this.directory.refreshRooms());
      }
    } catch (error) {
      this.log(`room refresh failed: ${readError(error)}`);
    }
    const rooms = this.directory.listRooms();
    this.renderRooms(rooms);
    return rooms;
  }

  private async restoreActiveClientSession(rooms: RoomInfo[]): Promise<void> {
    if (this.mode !== 'idle' || this.restoringClientSession) {
      return;
    }
    const stored = readActiveClientSession();
    if (!stored) {
      return;
    }
    const room = rooms.find((candidate) => candidate.roomId === stored.roomId);
    if (!room) {
      return;
    }
    this.restoringClientSession = true;
    try {
      this.log(`restoring room: ${room.name}`);
      await this.joinRoom(room, { allowReservedSlot: true });
    } finally {
      this.restoringClientSession = false;
    }
  }

  private storeActiveClientSession(roomId: string): void {
    writeActiveClientSession({ roomId, savedAt: Date.now() });
  }

  private clearActiveClientSession(): void {
    removeActiveClientSession();
  }

  private renderRooms(rooms: RoomInfo[]): void {
    this.currentRooms = rooms;
    void this.restoreActiveClientSession(rooms);
    this.roomSummary.innerHTML = '';
    const openRooms = rooms.filter(roomHasOpenSlot);
    const fullRooms = rooms.filter((room) => !roomHasOpenSlot(room));
    const activeCount = openRooms.length + fullRooms.length;
    this.roomSummary.textContent = activeCount > 0 ? `Active rooms: ${activeCount} · available ${openRooms.length} · full ${fullRooms.length}` : 'Active rooms: 0';
    this.roomList.innerHTML = '';
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'room-empty';
      empty.textContent = 'No hosted rooms visible on this origin.';
      this.roomList.append(empty);
      return;
    }
    const sortedRooms = [...openRooms, ...fullRooms];
    for (const room of sortedRooms) {
      const row = document.createElement('button');
      const stale = roomIsStale(room);
      const joinable = roomHasOpenSlot(room) && !stale;
      row.className = 'room-row';
      row.classList.toggle('room-row--full', !joinable);
      row.classList.toggle('room-row--stale', stale);
      row.type = 'button';
      row.disabled = !joinable;
      const rulesLabel = room.rulesetName ? `${room.rulesetName} (${room.rulesetId})` : room.rulesetId;
      row.innerHTML = `
        <span class="room-row__name">${escapeHtml(room.name)}</span>
        <span class="room-row__meta">${room.playerCount}/${room.maxPlayers}${stale ? ' · stale' : joinable ? '' : ' · full'} · rules ${escapeHtml(rulesLabel)}</span>
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
    if (this.mode === 'idle') {
      this.statusLine.textContent = status;
      this.menuStatusLine.textContent = status;
      return;
    }
    const players = this.lastSnapshot?.players.filter((player) => player.role === 'player').length ?? 0;
    const entities = this.lastSnapshot?.players.length ?? 0;
    const text = `${status} · players ${players} · entities ${entities}`;
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
    this.workbenchView.scrollTop = 0;
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
    if (target.hasAttribute('data-movement-package')) {
      if (event.type === 'change') await this.changeMovementPackage(target.value);
      return;
    }
    if (target.dataset.mechanicPreset && target instanceof HTMLInputElement) {
      if (event.type !== 'change') return;
      await this.handleMechanicPresetToggle(target.dataset.mechanicPreset, target.checked);
      return;
    }
    if (target.matches('[data-kit-slot], [data-kit-mutator], [data-kit-bouncy]')) {
      if (event.type !== 'change' || !this.kitDraft || target instanceof HTMLTextAreaElement) return;
      const selection = kitSelectionFromControl(this.kitDraft.selection, target);
      if (selection) await this.applyKitSelection(selection);
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
    if (target.dataset.teamSelect === 'true') {
      this.workbenchState.selectedTeamId = target.value;
      this.syncWorkbenchControls();
      return;
    }
    if (target.dataset.objectiveSelect === 'true') {
      this.workbenchState.selectedObjectiveId = target.value;
      this.syncWorkbenchControls();
      return;
    }
    if (target.dataset.objectiveKind === 'true') {
      const nextKind = target.value as 'relicPush' | 'deathmatch' | 'kingZone';
      const current = this.editableRuleset.objectives[0];
      if (!current || current.kind === nextKind) {
        return;
      }
      const next = structuredClone(this.editableRuleset) as Ruleset;
      next.objectives = [defaultObjectiveForKind(nextKind, current.id, next)];
      this.workbenchState.selectedObjectiveId = next.objectives[0].id;
      this.workbenchState.selectedScoreZoneId = '';
      await this.commitWorkbenchRules(next, 'objectives');
      return;
    }
    if (target.dataset.scoreZoneSelect === 'true') {
      this.workbenchState.selectedScoreZoneId = target.value;
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
    // A blur/change after an accepted input must not rebuild the next focused field.
    if (rulesetFingerprint(next) === rulesetFingerprint(this.editableRuleset)) return;
    await this.commitWorkbenchRules(next, workbenchFieldPath(edit, this.workbenchState));
  }

  private syncConfigurationSummary(): void {
    const summary = this.menuView.querySelector<HTMLElement>('#menu-current-rules');
    if (!summary) return;
    const rules = this.editableRuleset;
    const invalid = this.rulesValidationLine.classList.contains('is-error');
    const abilities = rules.loadout.abilityIds.map((id) => rules.abilities.find((entry) => entry.id === id)?.name).join(' / ');
    summary.innerHTML = `<strong>${escapeHtml(rules.name)}</strong><span>${escapeHtml(configurationSummary(rules))}</span><small>${escapeHtml(abilities)}</small>${invalid ? '<p class="draft-warning">Invalid JSON draft. This is the last valid configuration.</p>' : ''}`;
  }

  private async handleMechanicPresetToggle(presetId: string, enabled: boolean): Promise<void> {
    if (this.rulesValidationLine.classList.contains('is-error')) return;
    if (!isMechanicPresetId(presetId)) return;
    if (this.kitDraft) {
      const nextSelection = structuredClone(this.kitDraft.selection);
      if (presetId === 'combos') {
        nextSelection.combos = enabled;
      } else if (isExperimentAddonId(presetId)) {
        const addons = (nextSelection.addons ?? []).filter((id) => id !== presetId);
        if (enabled) addons.push(presetId);
        nextSelection.addons = addons;
      }
      await this.applyKitSelection(nextSelection);
      return;
    }
    const next = toggleMechanicPreset(this.editableRuleset, presetId, enabled);
    await this.commitWorkbenchRules(next, 'mechanics');
  }

  private async handleWorkbenchCommand(event: Event): Promise<void> {
    const inspectorButton = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-ability-lab], [data-inspect-trigger]');
    if (inspectorButton && !inspectorButton.disabled) {
      if (inspectorButton.hasAttribute('data-ability-lab')) await this.startSolo(true);
      else {
        this.workbenchState.selectedTriggerId = inspectorButton.dataset.inspectTrigger ?? '';
        this.selectWorkbenchTab('mechanics');
      }
      return;
    }
    const kitButton = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-kit-match], button[data-kit-customize], button[data-kit-start], button[data-library-group], button[data-experiment]');
    if (kitButton && !kitButton.disabled) {
      await this.handleLibraryCommand(kitButton);
      return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      'button[data-trigger-command], button[data-effect-command], button[data-condition-command], button[data-action-command], button[data-score-zone-command]',
    );
    if (!button || button.disabled) {
      return;
    }
    const command = workbenchCommandFromButton(button);
    if (!command) {
      return;
    }
    const next = structuredClone(this.editableRuleset) as Ruleset;
    if (!applyWorkbenchCommand(next, this.workbenchState, command)) {
      return;
    }
    await this.commitWorkbenchRules(next, workbenchCommandPath(command, this.workbenchState));
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

  private async handleLibraryCommand(button: HTMLButtonElement): Promise<void> {
    if (button.dataset.libraryGroup) {
      selectLibraryGroup(this.workbenchView, button.dataset.libraryGroup);
      return;
    }
    if (button.dataset.experiment) {
      const selection = withExperimentSelection(this.kitDraft?.selection, button.dataset.experiment);
      if (selection) {
        await this.applyKitSelection(selection);
      } else {
        await this.insertExperiment(button.dataset.experiment);
      }
      return;
    }
    await this.handleKitCommand(button);
  }

  private async handleKitCommand(button: HTMLButtonElement): Promise<void> {
    const match = MATCH_KITS.find((entry) => entry.id === button.dataset.kitMatch);
    if (match) await this.applyKitSelection(createKitSelection(match.id));
    if (button.dataset.kitCustomize) this.customizeKit(button.dataset.kitCustomize, button.dataset.kitAbilitySlot);
    if (button.dataset.kitStart === 'solo') await this.startSolo(false);
    if (button.dataset.kitStart === 'host') await this.hostRoom();
  }

  private customizeKit(tab: string, abilitySlot: string | undefined): void {
    if (!isWorkbenchTab(tab)) return;
    const slot = Number(abilitySlot);
    if (Number.isInteger(slot) && slot >= 0 && slot < 4) this.workbenchState.selectedAbilityId = this.editableRuleset.loadout.abilityIds[slot];
    this.selectWorkbenchTab(tab);
  }

  private async applyKitSelection(selection: KitSelection): Promise<void> {
    const ruleset = compileKit(selection);
    this.kitDraft = { selection, fingerprint: rulesetFingerprint(ruleset) };
    await this.commitWorkbenchRules(ruleset);
  }

  private async changeMovementPackage(id: string): Promise<void> {
    if (this.rulesValidationLine.classList.contains('is-error')) return;
    const chassis = MOVEMENT_CHASSIS.find((entry) => entry.id === id);
    if (!chassis) return;
    if (this.kitDraft) {
      await this.applyKitSelection({ ...structuredClone(this.kitDraft.selection), chassis: chassis.id });
    } else {
      await this.commitWorkbenchRules(withMovementPackage(this.editableRuleset, chassis.id), 'player');
    }
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
        path: shouldPreferEditPath(diagnostic.path) ? path ?? diagnostic.path : diagnostic.path,
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
    syncMovementPackages(this.workbenchView, ruleset);
    this.syncConfigurationSummary();
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
    this.workbenchPanelsRoot.closest('.workbench-layout')?.classList.toggle('is-ability-view', this.workbenchState.selectedTab === 'abilities');
    if (this.kitDraft && this.kitDraft.fingerprint !== rulesetFingerprint(ruleset)) this.kitDraft = undefined;
    const kits = this.workbenchView.querySelector<HTMLElement>('#workbench-panel-kits');
    if (kits) syncKitControls(kits, this.kitDraft?.selection, ruleset);
    if (this.rulesValidationLine.classList.contains('is-error')) {
      const status = this.workbenchView.querySelector<HTMLElement>('#kit-status');
      if (status) status.textContent = 'JSON draft is invalid. Showing the last valid configuration. Fix Advanced JSON before playing.';
    }

    setControlValue(this.workbenchView, '#workbench-rule-name', ruleset.name);
    setControlValue(this.workbenchView, '#workbench-duration', String(Math.round(ruleset.match.durationTicks / ruleset.tickRate)));
    setControlValue(this.workbenchView, '#workbench-score-limit', String(ruleset.match.scoreLimit));
    setControlChecked(this.workbenchView, '#workbench-friendly-fire', ruleset.match.friendlyFire);
    setControlValue(this.workbenchView, '#workbench-respawn-mode', ruleset.match.respawnMode === 'timed' ? 'Timed' : ruleset.match.respawnMode);
    const matchObjectives = this.workbenchView.querySelector<HTMLElement>('#workbench-match-objectives');
    if (matchObjectives) {
      matchObjectives.innerHTML = matchObjectivesHtml(ruleset, this.workbenchState);
    }

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
    const ability = ruleset.abilities.find((candidate) => candidate.id === this.workbenchState.selectedAbilityId);
    if (ability) {
      setControlValue(this.workbenchView, '#workbench-ability-damage', String(ability.damage));
      setControlValue(this.workbenchView, '#workbench-ability-cooldown', String(ability.cooldownTicks));
      setControlValue(this.workbenchView, '#workbench-ability-range', String(ability.range));
      setControlValue(this.workbenchView, '#workbench-ability-radius', String(ability.radius));
      setControlValue(this.workbenchView, '#workbench-ability-targeting', ability.targeting);
      setControlValue(this.workbenchView, '#workbench-ability-color', ability.color);
    }
    const abilityEffects = this.workbenchView.querySelector<HTMLElement>('#workbench-ability-effects');
    if (abilityEffects) {
      abilityEffects.innerHTML = abilityEffectsHtml(ruleset, this.workbenchState.selectedAbilityId);
    }
    const abilityInspector = this.workbenchView.querySelector<HTMLElement>('#workbench-ability-inspector');
    if (abilityInspector) abilityInspector.innerHTML = abilityInspectorHtml(ruleset, this.workbenchState.selectedAbilityId);

    const mechanicsPresets = this.workbenchView.querySelector<HTMLElement>('#workbench-mechanics-presets');
    if (mechanicsPresets) {
      mechanicsPresets.innerHTML = mechanicsPresetsHtml(ruleset);
    }
    const triggerOptions = ruleset.mechanics.triggers.map((trigger) => ({ value: trigger.id, label: trigger.name ?? trigger.id }));
    setSelectOptions(this.workbenchView, '#workbench-trigger-select', triggerOptions, this.workbenchState.selectedTriggerId);
    const trigger = ruleset.mechanics.triggers.find((candidate) => candidate.id === this.workbenchState.selectedTriggerId);
    const triggerFields = this.workbenchView.querySelector<HTMLElement>('#workbench-trigger-fields');
    if (triggerFields) {
      triggerFields.hidden = !trigger;
      for (const control of triggerFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
        control.disabled = !trigger;
      }
    }
    const removeTriggerButton = this.workbenchView.querySelector<HTMLButtonElement>('#workbench-remove-trigger');
    if (removeTriggerButton) {
      removeTriggerButton.disabled = !trigger;
    }
    if (trigger) {
      setControlValue(this.workbenchView, '#workbench-trigger-name', trigger.name ?? trigger.id);
      setControlValue(this.workbenchView, '#workbench-trigger-event', trigger.event);
    }
    const mechanicsChain = this.workbenchView.querySelector<HTMLElement>('#workbench-mechanics-chain');
    if (mechanicsChain) {
      mechanicsChain.innerHTML = mechanicsChainHtml(ruleset, this.workbenchState.selectedTriggerId);
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

    setControlValue(this.workbenchView, '#pref-hud-scale', String(this.uiPreferences.hudScale));
    setControlValue(this.workbenchView, '#pref-skill-position', this.uiPreferences.skillBarPosition);
    setControlValue(this.workbenchView, '#pref-touch-handedness', this.uiPreferences.touchHandedness);
    setControlValue(this.workbenchView, '#pref-touch-scale', String(this.uiPreferences.touchScale));
    setControlValue(this.workbenchView, '#pref-touch-opacity', String(this.uiPreferences.touchOpacity));
    setControlChecked(this.workbenchView, '#pref-trace-open', this.uiPreferences.traceDefaultOpen);
    setControlValue(this.workbenchView, '#pref-hud-density', this.uiPreferences.hudDensity);
    this.syncConditionalWorkbenchFields(ruleset);
    const invalidDraft = this.rulesValidationLine.classList.contains('is-error');
    for (const input of this.workbenchView.querySelectorAll<HTMLInputElement>('[data-movement-package], [data-mechanic-preset]')) input.disabled = invalidDraft;
    this.renderWorkbenchDiagnostics();
  }

  private syncConditionalWorkbenchFields(ruleset: Ruleset): void {
    for (const field of this.workbenchView.querySelectorAll<HTMLElement>('[data-visible-when]')) {
      const [fieldId, expected] = (field.dataset.visibleWhen ?? '').split(':');
      const visible = fieldId === 'movementMode' ? ruleset.player.movement.mode === expected : true;
      field.hidden = !visible;
      for (const control of field.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
        control.disabled = !visible;
      }
    }
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
    shell.dataset.controlBucket = this.capabilities.bucket;
    const profileId = this.resolveControlProfileId();
    shell.dataset.controlProfile = profileId;
    if (this.controlProfileSelect) {
      const selectedRaw = resolveActiveProfileId(this.uiPreferencesV2, this.capabilities.bucket);
      this.controlProfileSelect.value = selectedRaw;
    }
    this.applyControlProfile(profileId);
    const log = this.root.querySelector<HTMLDetailsElement>('#arena-log');
    if (log) {
      log.open = this.uiPreferences.traceDefaultOpen;
    }
  }

  /**
   * Picks the active control profile for the current capability bucket and
   * coerces it to be coherent with the active ruleset's movement/aim modes.
   * Surfaced via `data-control-profile` on the app shell so tests and CSS can
   * branch on it; runtime gating lives in {@link applyControlProfile}.
   */
  private resolveControlProfileId(): UiProfileId {
    const base = resolveActiveProfileId(this.uiPreferencesV2, this.capabilities.bucket);
    const rules = this.ruleset ?? this.editableRuleset;
    if (!rules) return base;
    return adaptProfileToRules(base, {
      movement: rules.player.movement.mode,
      aim: rules.player.aim.mode,
    });
  }

  /**
   * Switches runtime input ownership based on the active profile.
   *
   * Reads {@link getProfileBehavior} to decide:
   * - `pointerWorldMode` — whether the canvas captures world taps and how
   *   (none / tap-target / tap-fire).
   * - `disablesMouseAim` — whether to silence mouse-driven aim updates.
   *
   * Override side-effects (queueing slot-0 casts, etc.) happen later in the
   * dispatcher; this method only wires the input *sources*.
   */
  private applyControlProfile(profileId: UiProfileId): void {
    this.input.setControlProfile(profileId);
    const behavior = getProfileBehavior(profileId);
    const usesPointerWorld = behavior.pointerWorldMode !== 'none';
    const alreadyApplied =
      this.activeControlProfile === profileId &&
      (this.unsubscribePointerWorld !== undefined) === usesPointerWorld;
    if (alreadyApplied) {
      return;
    }
    this.activeControlProfile = profileId;
    this.unsubscribePointerWorld?.();
    this.unsubscribePointerWorld = undefined;
    this.tapMoveTarget = undefined;
    this.pendingTapFire = undefined;
    if (behavior.pointerWorldMode === 'tap-target') {
      this.input.setClickToCastEnabled(false);
      const sub = this.pointerWorld.onIntent((intent) => {
        this.tapMoveTarget = { x: intent.worldX, y: intent.worldY };
      });
      this.unsubscribePointerWorld = () => {
        sub();
      };
    } else if (behavior.pointerWorldMode === 'tap-fire') {
      this.input.setClickToCastEnabled(false);
      this.input.setMouseAimEnabled(false);
      this.unsubscribePointerWorld = installTapFirePointerGesture({
        canvas: this.canvas,
        clientToWorld: (clientX, clientY) => this.renderer.clientToWorld(clientX, clientY),
        getAimOrigin: () => this.getLocalPlayerAimOrigin(),
        setExplicitAim: (aim) => this.input.setLastExplicitAim(aim),
        pressPrimarySlot: () => this.input.pressSlot(0),
        releasePrimarySlot: () => this.input.releaseSlot(0),
        queueQuickTapFire: (world) => {
          this.pendingTapFire = { worldX: world.x, worldY: world.y };
        },
      });
    } else {
      this.input.setClickToCastEnabled(true);
    }
    if (!behavior.disablesMouseAim) {
      this.input.setMouseAimEnabled(true);
    }
    this.maybeShowProfileHint(profileId);
  }

  /**
   * Shows a transient HUD hint the first time a user activates a tap-driven
   * profile. The "shown" flag is persisted in v2 prefs so it never re-appears
   * after the user has seen it once. Hint text comes from the profile
   * registry.
   */
  private maybeShowProfileHint(profileId: UiProfileId): void {
    const hintText = getProfileBehavior(profileId).hintText;
    if (!hintText) {
      this.hideArenaHint();
      return;
    }
    if (this.uiPreferencesV2.shownHints[profileId]) {
      return;
    }
    this.showArenaHint(hintText);
    this.uiPreferencesV2 = {
      ...this.uiPreferencesV2,
      shownHints: { ...this.uiPreferencesV2.shownHints, [profileId]: true },
    };
    saveUiPreferencesV2(this.uiPreferencesV2);
  }

  private showArenaHint(text: string): void {
    if (this.arenaHintTimer !== undefined) {
      window.clearTimeout(this.arenaHintTimer);
      this.arenaHintTimer = undefined;
    }
    this.arenaHintEl.textContent = text;
    this.arenaHintEl.hidden = false;
    this.arenaHintEl.dataset.visible = 'true';
    this.arenaHintTimer = window.setTimeout(() => this.hideArenaHint(), 3000);
  }

  private hideArenaHint(): void {
    if (this.arenaHintTimer !== undefined) {
      window.clearTimeout(this.arenaHintTimer);
      this.arenaHintTimer = undefined;
    }
    this.arenaHintEl.hidden = true;
    delete this.arenaHintEl.dataset.visible;
  }

  /**
   * Persists the user's profile choice for the current capability bucket and
   * re-applies UI prefs so the rules-adapted profile id, data attributes, and
   * pointer-world subscription update in lock-step.
   */
  private handleControlProfileChange(): void {
    const raw = this.controlProfileSelect.value;
    if (!isUiProfileId(raw)) {
      return;
    }
    this.uiPreferencesV2 = {
      ...this.uiPreferencesV2,
      activeProfileByBucket: {
        ...this.uiPreferencesV2.activeProfileByBucket,
        [this.capabilities.bucket]: raw,
      },
    };
    saveUiPreferencesV2(this.uiPreferencesV2);
    this.applyUiPreferences();
  }

  /**
   * Pen-hover aim-ghost: track the hovered world point while a pen pointer is
   * moving across the canvas without any button pressed, and push it to the
   * renderer so it can draw a faint reticle there. Touch never reports hover;
   * mouse already has a real cursor; pen is the only pointer type that gains
   * a usable preview from this.
   */
  private readonly onCanvasPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'pen') {
      return;
    }
    if (event.buttons !== 0) {
      this.clearPenHover();
      return;
    }
    const world = this.renderer.clientToWorld(event.clientX, event.clientY);
    if (!world) {
      return;
    }
    this.penHoverWorld = { x: world.x, y: world.y };
    this.renderer.setAimGhost(this.penHoverWorld);
  };

  private readonly onCanvasPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'pen') {
      return;
    }
    this.clearPenHover();
  };

  private readonly onCanvasPointerDownForHover = (event: PointerEvent): void => {
    if (event.pointerType !== 'pen') {
      return;
    }
    this.clearPenHover();
  };

  private clearPenHover(): void {
    if (!this.penHoverWorld) {
      return;
    }
    this.penHoverWorld = undefined;
    this.renderer.setAimGhost(undefined);
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
    if (this.snapshotSmoother) this.smoothingStats = this.snapshotSmoother.stats();
    if (this.ruleset && this.mode !== 'idle' && this.mode !== 'replay') {
      this.replays.capture(this.ruleset, this.mode, snapshot, this.localPlayerId, this.smoothingStats, this.snapshotSmoother?.predictionAtTick(snapshot.tick));
    }
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

  private watchReplay(clip: ReplayClip): void {
    if (this.mode !== 'idle' || this.pwa.applyingUpdate) return;
    this.stopActiveMode();
    this.mode = 'replay';
    this.ruleset = clip.metadata.ruleset;
    this.replays.play(clip);
    this.renderer.setRuleset(this.ruleset);
    this.renderer.setLocalPlayer(clip.metadata.localPlayerId);
    this.showArena();
    this.input.stop();
    this.input.reset(false);
    this.arenaView.classList.add('is-replay');
    this.hashLine.textContent = clip.metadata.ruleset.name;
    this.renderer.setSnapshotProvider(() => {
      const view = this.replays.render(performance.now());
      if (!view) return undefined;
      this.renderer.setPredictionGhost(view.predictionGhost);
      this.lastSnapshot = view.snapshot;
      window.__BEAT_SNAPSHOT__ = view.snapshot;
      window.__BEAT_RENDER_SNAPSHOT__ = view.snapshot;
      this.updateMatchHud(view.snapshot);
      return view.snapshot;
    });
    this.setStatus(`Replay · ${clip.metadata.source}`);
    this.networkLine.textContent = 'Replay playback';
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
    if (this.labControlsRoot) {
      this.labControlsRoot.open = !window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    }
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
    if (this.pwa.applyingUpdate) return undefined;
    try {
      return this.currentRuleset();
    } catch (error) {
      this.workbenchDiagnostics = diagnosticsFromError(error);
      this.showWorkbench();
      this.selectWorkbenchTab('advanced');
      this.rulesJsonInput.focus();
      this.log(`rules rejected: ${readError(error)}`);
      return undefined;
    }
  }

  private async resetRules(): Promise<void> {
    this.editableRuleset = createDefaultRuleset();
    this.kitDraft = {
      selection: createExperimentSelection('combo-preset'),
      fingerprint: rulesetFingerprint(this.editableRuleset),
    };
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
      this.syncWorkbenchControls();
    }
  }

  private async insertExperiment(example: string): Promise<void> {
    try {
      const ruleset = parseWorkbenchDocumentJson(this.rulesJsonInput.value).ruleset;
      const nextRuleset = applyExperiment(ruleset, example);
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
    void this.refreshRoomsNow();
    this.syncFullscreenButton();
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
    if (this.ruleset) this.input.start(this.ruleset.tickRate);
    this.syncLabControls();
    this.syncFullscreenButton();
    requestAnimationFrame(() => this.renderer.resizeNow());
    this.setRulesLocked(true);
    this.updateSkillBar(this.lastSnapshot);
  }

  private canFullscreen(): boolean {
    return typeof this.root.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  }

  private syncFullscreenButton(): void {
    const active = document.fullscreenElement === this.root;
    for (const button of this.fullscreenButtons) {
      button.disabled = !this.canFullscreen();
      button.textContent = active ? 'Window' : 'Fullscreen';
      button.setAttribute('aria-pressed', String(active));
      button.title = this.canFullscreen() ? (active ? 'Exit fullscreen' : 'Enter fullscreen') : 'Fullscreen is unavailable in this browser';
    }
  }

  private async toggleFullscreen(): Promise<void> {
    if (!this.canFullscreen()) {
      return;
    }
    try {
      if (document.fullscreenElement === this.root) {
        await document.exitFullscreen();
        return;
      }
      await this.root.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      this.log(`fullscreen unavailable: ${readError(error)}`);
    } finally {
      this.syncFullscreenButton();
    }
  }

  private async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement !== this.root) {
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

function loadSessionPeerId(): string {
  const existing = readSessionItem(PEER_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const peerId = createId('peer');
  writeSessionItem(PEER_ID_STORAGE_KEY, peerId);
  return peerId;
}

function readActiveClientSession(): StoredActiveClientSession | undefined {
  const raw = readSessionItem(ACTIVE_CLIENT_SESSION_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredActiveClientSession>;
    if (typeof parsed.roomId !== 'string' || typeof parsed.savedAt !== 'number') {
      removeActiveClientSession();
      return undefined;
    }
    if (Date.now() - parsed.savedAt > ACTIVE_CLIENT_SESSION_TTL_MS) {
      removeActiveClientSession();
      return undefined;
    }
    return { roomId: parsed.roomId, savedAt: parsed.savedAt };
  } catch {
    removeActiveClientSession();
    return undefined;
  }
}

function writeActiveClientSession(session: StoredActiveClientSession): void {
  writeSessionItem(ACTIVE_CLIENT_SESSION_KEY, JSON.stringify(session));
}

function removeActiveClientSession(): void {
  try {
    window.sessionStorage.removeItem(ACTIVE_CLIENT_SESSION_KEY);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function readSessionItem(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionItem(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function roomIsStale(room: RoomInfo | undefined): boolean {
  return Boolean(room && Date.now() - room.lastHeartbeat > ROOM_STALE_MS);
}

function roomHasOpenSlot(room: RoomInfo): boolean {
  return room.status === 'open' && room.playerCount < room.maxPlayers;
}

const CONTROL_PROFILE_OPTIONS: ReadonlyArray<{ value: UiProfileId; label: string }> = getControlProfileOptions();

const UI_PROFILE_ID_SET: ReadonlySet<UiProfileId> = new Set<UiProfileId>([...BUILTIN_PROFILE_IDS, 'custom']);

function isUiProfileId(value: string): value is UiProfileId {
  return UI_PROFILE_ID_SET.has(value as UiProfileId);
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
              <button id="menu-fullscreen-toggle" class="button fullscreen-toggle-button" type="button">Fullscreen</button>
              <button id="open-workbench" class="button button--full" type="button">Choose match / experiment</button>
            </div>
            <div id="menu-status-line" class="menu-status">starting</div>
            <section class="menu-configuration" aria-label="Current configuration">
              <h2>Current configuration</h2>
              <div id="menu-current-rules" class="menu-current-rules"></div>
            </section>
            <section class="room-section">
              <div class="room-section__header">
                <h2>Rooms</h2>
                <button id="refresh-rooms" class="button room-refresh-button" type="button">Refresh</button>
              </div>
              <div id="room-summary" class="room-summary"></div>
              <div id="room-list" class="room-list"></div>
            </section>
            ${deviceSessionHtml()}
            <section class="replay-library" aria-labelledby="replay-heading">
              <h2 id="replay-heading">Replays</h2>
              <div class="button-grid">
                <button id="watch-replay" class="button" type="button" disabled>Watch last replay</button>
                <button id="export-replay" class="button" type="button" disabled>Export replay</button>
                <button id="import-replay" class="button" type="button">Import replay</button>
                <input id="replay-file" type="file" accept=".beat" aria-label="Replay file" hidden />
              </div>
              <div id="replay-summary" class="room-summary" role="status"></div>
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
        <div id="arena-hint" class="arena-hint" data-arena-hint hidden></div>
        <div class="arena-actions">
          <label class="control-profile-picker">
            <span class="control-profile-picker__label">Controls</span>
            <select id="control-profile-select" class="control-profile-picker__select" aria-label="Control profile">
              ${CONTROL_PROFILE_OPTIONS.map(
                (option) => `<option value="${option.value}">${option.label}</option>`,
              ).join('')}
            </select>
          </label>
          <button id="leave-room" class="button arena-action-button" type="button">Menu</button>
          <button class="button arena-action-button" type="button" data-wake-lock data-wake-lock-compact aria-label="Keep screen awake" aria-pressed="false">☀</button>
          <button id="export-live-replay" class="button arena-action-button" type="button" disabled>Save replay</button>
        </div>
        <div id="replay-live-status" class="replay-live-status" role="status"></div>
        <section id="replay-controls" class="replay-controls" aria-label="Replay controls" hidden>
          <div class="replay-controls__row">
            <button id="replay-toggle" class="button" type="button" aria-pressed="false">Play replay</button>
            <button id="replay-back" class="button" type="button" aria-label="Previous replay frame">−1 frame</button>
            <button id="replay-forward" class="button" type="button" aria-label="Next replay frame">+1 frame</button>
            <label>Speed <select id="replay-speed" aria-label="Replay speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
            <label><input id="replay-ghost" type="checkbox" checked /> Prediction ghost</label>
          </div>
          <input id="replay-timeline" type="range" min="0" max="0" step="1" value="0" aria-label="Replay position" />
          <div id="replay-time"></div>
          <div id="replay-details" class="room-summary"></div>
        </section>
        <details id="lab-controls" class="lab-controls" open hidden>
          <summary class="lab-controls__title">Lab Bench</summary>
          <div class="lab-controls__body">
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
        </details>
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

function shouldPreferEditPath(diagnosticPath: string): boolean {
  return (
    diagnosticPath === '$' ||
    diagnosticPath.startsWith('ability.effect') ||
    diagnosticPath.startsWith('mechanics.trigger') ||
    diagnosticPath.startsWith('objective.')
  );
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
