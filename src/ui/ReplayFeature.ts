import type { EngineSnapshot, Ruleset } from '../engine/protocol';
import type { SnapshotSmoothingStats } from '../net/snapshotSmoothing';
import { MAX_REPLAY_FILE_BYTES, parseReplay, ReplayRecorder, serializeReplay, type ReplayClip, type ReplaySource } from '../replay/archive';
import { ReplayPlayer, type ReplayView } from '../replay/player';

/** Owns replay UI, file lifetimes, the current recording, and visual playback. */
export class ReplayFeature {
  private readonly events = new AbortController();
  private readonly watch: HTMLButtonElement;
  private readonly exports: HTMLButtonElement[];
  private readonly file: HTMLInputElement;
  private readonly summary: HTMLElement;
  private readonly liveStatus: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly timeline: HTMLInputElement;
  private readonly speed: HTMLSelectElement;
  private readonly time: HTMLElement;
  private readonly details: HTMLElement;
  private readonly downloads = new Map<string, number>();
  private recorder?: ReplayRecorder;
  private retained?: ReplayClip;
  private player?: ReplayPlayer;
  private rules?: Ruleset;
  private rulesJson = '';
  private source?: ReplaySource;
  private recorded = false;
  private recordingFailed = false;
  private generation = 0;
  private destroyed = false;
  private notice?: string;

  constructor(root: HTMLElement, private readonly onOpen: (clip: ReplayClip) => void) {
    const node = <T extends Element>(selector: string): T => {
      const element = root.querySelector<T>(selector);
      if (!element) throw new Error(`Missing replay control ${selector}`);
      return element;
    };
    this.watch = node('#watch-replay');
    this.exports = [node('#export-replay'), node('#export-live-replay')];
    this.file = node('#replay-file');
    this.summary = node('#replay-summary');
    this.liveStatus = node('#replay-live-status');
    this.controls = node('#replay-controls');
    this.toggle = node('#replay-toggle');
    this.timeline = node('#replay-timeline');
    this.speed = node('#replay-speed');
    this.time = node('#replay-time');
    this.details = node('#replay-details');
    const options = { signal: this.events.signal };
    this.watch.addEventListener('click', () => { const clip = this.currentClip(); if (clip) this.onOpen(clip); }, options);
    for (const button of this.exports) button.addEventListener('click', () => this.download(), options);
    node('#import-replay').addEventListener('click', () => this.file.click(), options);
    this.file.addEventListener('change', () => void this.importFile(), options);
    this.toggle.addEventListener('click', () => {
      if (!this.player) return;
      this.player.setPlaying(!this.player.frame(performance.now()).playing);
    }, options);
    this.timeline.addEventListener('input', () => {
      this.player?.setPlaying(false);
      this.player?.seek(Number(this.timeline.value));
    }, options);
    this.speed.addEventListener('change', () => this.player?.setSpeed(Number(this.speed.value)), options);
    for (const [selector, direction] of [['#replay-back', -1], ['#replay-forward', 1]] as const) {
      node(selector).addEventListener('click', () => {
        if (!this.player) return;
        const current = this.player.frame(performance.now());
        this.player.setPlaying(false);
        this.player.seek(current.positionMs + direction * 1000 / this.player.clip.metadata.ruleset.tickRate);
      }, options);
    }
    this.syncButtons();
  }

  capture(rules: Ruleset, source: ReplaySource, snapshot: EngineSnapshot, localPlayerId?: string, stats?: SnapshotSmoothingStats): void {
    if (this.destroyed || this.recordingFailed) return;
    try {
      const rulesChanged = rules !== this.rules && JSON.stringify(rules) !== this.rulesJson;
      if (!this.recorder || this.source !== source || rulesChanged) {
        this.generation++;
        this.retained = undefined;
        this.notice = undefined;
        this.rulesJson = JSON.stringify(rules);
        this.source = source;
        this.recorded = false;
        this.recorder = new ReplayRecorder({ version: 1, ruleset: rules, source, localPlayerId, recordedAt: Date.now() });
      }
      this.rules = rules;
      this.recorded = this.recorder.record(snapshot, source === 'client' && stats ? {
        pendingInputs: stats.pendingInputs, predictionError: stats.predictionErrorEwma, snapCorrections: stats.snapCorrections,
      } : undefined) || this.recorded;
      this.liveStatus.textContent = 'Recording replay';
      for (const button of this.exports) button.disabled = !this.recorded;
    } catch (error) {
      this.retained = this.recorder?.clip();
      this.recorder = undefined;
      this.recordingFailed = true;
      this.notice = `Replay recording stopped: ${message(error)}`;
      this.liveStatus.textContent = this.notice;
      this.syncButtons();
    }
  }

  endSession(): void {
    this.generation++;
    if (this.recorder) this.retained = this.recorder.clip() ?? this.retained;
    this.recorder = undefined;
    this.recordingFailed = false;
    this.rules = undefined;
    this.player = undefined;
    this.controls.hidden = true;
    this.file.value = '';
    this.file.disabled = false;
    this.liveStatus.textContent = '';
    this.syncButtons();
  }

  play(clip: ReplayClip): void {
    this.retained = clip;
    this.player = new ReplayPlayer(clip);
    this.notice = undefined;
    this.controls.hidden = false;
    this.timeline.max = String(clip.durationMs);
    this.timeline.value = '0';
    this.speed.value = '1';
    this.syncButtons();
  }

  render(nowMs: number): ReplayView | undefined {
    const view = this.player?.frame(nowMs);
    if (!view) return undefined;
    this.toggle.textContent = view.playing ? 'Pause replay' : 'Play replay';
    this.toggle.setAttribute('aria-pressed', String(view.playing));
    this.timeline.value = String(view.positionMs);
    this.time.textContent = `${seconds(view.positionMs)} / ${seconds(view.durationMs)} · tick ${view.snapshot.tick}`;
    this.details.textContent = view.diagnostics
      ? `Recorded prediction error (avg): ${view.diagnostics.predictionError.toFixed(3)} m · pending inputs ${view.diagnostics.pendingInputs} · corrections ${view.diagnostics.snapCorrections}`
      : 'Recorded authoritative state';
    return view;
  }

  destroy(): void {
    this.destroyed = true;
    this.events.abort();
    this.endSession();
    for (const [url, timer] of this.downloads) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
    this.downloads.clear();
    this.retained = undefined;
  }

  private currentClip(): ReplayClip | undefined { return this.recorder?.clip() ?? this.retained; }
  private syncButtons(): void {
    const available = this.recorder ? this.recorded : Boolean(this.retained);
    this.watch.disabled = !available;
    for (const button of this.exports) button.disabled = !available;
    const clip = this.retained;
    this.summary.textContent = this.notice ?? (clip ? `${seconds(clip.durationMs)} retained · ${(clip.bytes / 1024).toFixed(0)} KB · ${clip.metadata.source}` : 'Play a session to record a replay. The latest recording stays here until your next session.');
  }
  private download(): void {
    const clip = this.currentClip();
    if (!clip) return;
    try {
      const bytes = serializeReplay(clip);
      const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `beat-replay-${clip.frames[0].tick}.beat`;
      link.click();
      const timer = window.setTimeout(() => { URL.revokeObjectURL(url); this.downloads.delete(url); }, 1_000);
      this.downloads.set(url, timer);
    } catch (error) { this.notice = `Replay export failed: ${message(error)}`; this.liveStatus.textContent = this.notice; this.syncButtons(); }
  }
  private async importFile(): Promise<void> {
    const file = this.file.files?.[0];
    if (!file) return;
    const generation = ++this.generation;
    this.file.disabled = true;
    this.notice = 'Loading replay…';
    this.syncButtons();
    try {
      if (file.size > MAX_REPLAY_FILE_BYTES) throw new Error('File exceeds the replay size limit');
      const buffer = await file.arrayBuffer();
      if (this.destroyed || generation !== this.generation) return;
      const clip = parseReplay(buffer);
      this.retained = clip;
      this.notice = undefined;
      this.onOpen(clip);
    } catch (error) {
      if (!this.destroyed && generation === this.generation) this.notice = `Replay import failed: ${message(error)}`;
    } finally {
      if (!this.destroyed && generation === this.generation) { this.file.disabled = false; this.file.value = ''; this.syncButtons(); }
    }
  }
}

function seconds(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
