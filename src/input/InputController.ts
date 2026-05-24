import type { PlayerInput } from '../engine/protocol';

type InputListener = (input: PlayerInput) => void;

export type TouchControlElements = {
  root: HTMLElement;
  joystick: HTMLElement;
  joystickKnob: HTMLElement;
  firePad: HTMLElement;
  fireKnob: HTMLElement;
  skillButtons: HTMLElement[];
};

type Vec2 = { x: number; y: number };

export class InputController {
  private readonly keys = new Set<string>();
  private readonly listeners = new Set<InputListener>();
  private sequence = 0;
  private mouseAim?: Vec2;
  private touchMove: Vec2 = { x: 0, y: 0 };
  private touchAim: Vec2 = { x: 0, y: 0 };
  private lastExplicitAim: Vec2 = { x: 1, y: 0 };
  private hasExplicitAim = false;
  private joystickPointerId?: number;
  private firePointerId?: number;
  private skillPointerId?: number;
  private skillPointerSlot?: number;
  private skillPointerElement?: HTMLElement;
  private firePressed = false;
  private aimOrigin?: Vec2;
  private queuedCastSlots: number[] = [];
  private queuedSlotPresses: number[] = [];
  private queuedSlotReleases: number[] = [];
  private interval?: number;

  constructor(
    private readonly target: HTMLCanvasElement,
    private readonly controls?: TouchControlElements,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onFocusLost);
    window.addEventListener('pagehide', this.onFocusLost);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    controls?.joystick.addEventListener('pointerdown', this.onJoystickPointerDown);
    controls?.joystick.addEventListener('pointermove', this.onJoystickPointerMove);
    controls?.joystick.addEventListener('pointerup', this.onJoystickPointerUp);
    controls?.joystick.addEventListener('pointercancel', this.onJoystickPointerUp);
    controls?.firePad.addEventListener('pointerdown', this.onFirePointerDown);
    controls?.firePad.addEventListener('pointermove', this.onFirePointerMove);
    controls?.firePad.addEventListener('pointerup', this.onFirePointerUp);
    controls?.firePad.addEventListener('pointercancel', this.onFirePointerCancel);
    for (const button of controls?.skillButtons ?? []) {
      button.addEventListener('pointerdown', this.onSkillPointerDown);
      button.addEventListener('pointermove', this.onSkillPointerMove);
      button.addEventListener('pointerup', this.onSkillPointerUp);
      button.addEventListener('pointercancel', this.onSkillPointerCancel);
    }
  }

  start(rateHz = 30): void {
    this.stop();
    this.interval = window.setInterval(() => this.emit(), 1000 / rateHz);
  }

  stop(): void {
    if (this.interval !== undefined) {
      window.clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  onInput(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setAimOrigin(origin: Vec2 | undefined): void {
    this.aimOrigin = origin;
  }

  reset(emitNeutral = true): void {
    this.keys.clear();
    this.mouseAim = undefined;
    this.touchMove = { x: 0, y: 0 };
    this.touchAim = { x: 0, y: 0 };
    this.firePressed = false;
    this.releasePointerCapture(this.controls?.joystick, this.joystickPointerId);
    this.releasePointerCapture(this.controls?.firePad, this.firePointerId);
    this.releasePointerCapture(this.skillPointerElement, this.skillPointerId);
    this.joystickPointerId = undefined;
    this.firePointerId = undefined;
    this.skillPointerId = undefined;
    this.skillPointerSlot = undefined;
    this.skillPointerElement = undefined;
    this.controls?.joystickKnob.style.setProperty('--knob-x', '0px');
    this.controls?.joystickKnob.style.setProperty('--knob-y', '0px');
    this.controls?.fireKnob.style.setProperty('--knob-x', '0px');
    this.controls?.fireKnob.style.setProperty('--knob-y', '0px');
    if (emitNeutral) {
      this.emit();
    } else {
      this.queuedCastSlots = [];
      this.queuedSlotPresses = [];
      this.queuedSlotReleases = [];
    }
  }

  destroy(): void {
    this.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onFocusLost);
    window.removeEventListener('pagehide', this.onFocusLost);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerUp);
    this.controls?.joystick.removeEventListener('pointerdown', this.onJoystickPointerDown);
    this.controls?.joystick.removeEventListener('pointermove', this.onJoystickPointerMove);
    this.controls?.joystick.removeEventListener('pointerup', this.onJoystickPointerUp);
    this.controls?.joystick.removeEventListener('pointercancel', this.onJoystickPointerUp);
    this.controls?.firePad.removeEventListener('pointerdown', this.onFirePointerDown);
    this.controls?.firePad.removeEventListener('pointermove', this.onFirePointerMove);
    this.controls?.firePad.removeEventListener('pointerup', this.onFirePointerUp);
    this.controls?.firePad.removeEventListener('pointercancel', this.onFirePointerCancel);
    for (const button of this.controls?.skillButtons ?? []) {
      button.removeEventListener('pointerdown', this.onSkillPointerDown);
      button.removeEventListener('pointermove', this.onSkillPointerMove);
      button.removeEventListener('pointerup', this.onSkillPointerUp);
      button.removeEventListener('pointercancel', this.onSkillPointerCancel);
    }
    this.listeners.clear();
  }

  private emit(): void {
    const keyboardX = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const keyboardY = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    const move = normalized({
      x: keyboardX + this.touchMove.x,
      y: keyboardY + this.touchMove.y,
    });
    const touchAiming = this.firePressed || this.skillPointerId !== undefined;
    const explicitAim = touchAiming && magnitude(this.touchAim) > 0.01 ? normalized(this.touchAim) : this.mouseAim;
    if (explicitAim && magnitude(explicitAim) > 0.01) {
      this.lastExplicitAim = explicitAim;
      this.hasExplicitAim = true;
    }
    const fallbackAim = this.hasExplicitAim ? this.lastExplicitAim : magnitude(move) > 0.01 ? move : { x: 1, y: 0 };
    const aim = explicitAim ?? fallbackAim;
    const castSlots = this.drainCastSlots();
    const slotPresses = this.drainSlotPresses();
    const slotReleases = this.drainSlotReleases();
    const input: PlayerInput = {
      sequence: ++this.sequence,
      moveX: move.x,
      moveY: move.y,
      aimDx: aim.x,
      aimDy: aim.y,
      castSlots,
      slotPresses,
      slotReleases,
      sampledAtMs: performance.now(),
    };
    for (const listener of this.listeners) {
      listener(input);
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) {
      return;
    }
    if (isGameKey(event.code)) {
      event.preventDefault();
      const slot = slotForKey(event.code);
      if (slot !== undefined && !this.keys.has(event.code)) {
        this.queueSlotPress(slot);
        this.queueCast(slot);
      }
      this.keys.add(event.code);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) {
      return;
    }
    if (isGameKey(event.code)) {
      event.preventDefault();
      const slot = slotForKey(event.code);
      if (slot !== undefined && this.keys.has(event.code)) {
        this.queueSlotRelease(slot);
      }
      this.keys.delete(event.code);
    }
  };

  private readonly onFocusLost = (): void => {
    this.reset();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.reset();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') {
      return;
    }
    this.updateMouseAim(event);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.updateMouseAim(event);
    this.queueSlotPress(0);
    this.queueCast(0);
    this.target.setPointerCapture(event.pointerId);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }
    this.updateMouseAim(event);
    this.queueSlotRelease(0);
  };

  private readonly onJoystickPointerDown = (event: PointerEvent): void => {
    this.joystickPointerId = event.pointerId;
    this.controls?.joystick.setPointerCapture(event.pointerId);
    this.updateJoystick(event);
  };

  private readonly onJoystickPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.joystickPointerId) {
      this.updateJoystick(event);
    }
  };

  private readonly onJoystickPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointerId) {
      return;
    }
    this.joystickPointerId = undefined;
    this.touchMove = { x: 0, y: 0 };
    this.controls?.joystickKnob.style.setProperty('--knob-x', '0px');
    this.controls?.joystickKnob.style.setProperty('--knob-y', '0px');
  };

  private readonly onFirePointerDown = (event: PointerEvent): void => {
    this.firePointerId = event.pointerId;
    this.firePressed = true;
    this.controls?.firePad.setPointerCapture(event.pointerId);
    this.updateFire(event);
    this.queueSlotPress(0);
  };

  private readonly onFirePointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.firePointerId) {
      this.updateFire(event);
    }
  };

  private readonly onFirePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.firePointerId) {
      return;
    }
    this.updateFire(event);
    this.rememberTouchAim();
    this.queueCast(0);
    this.queueSlotRelease(0);
    this.clearFirePointer();
  };

  private readonly onFirePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.firePointerId) {
      return;
    }
    this.clearFirePointer();
  };

  private readonly onSkillPointerDown = (event: PointerEvent): void => {
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    const slot = button ? slotFromElement(button) : undefined;
    if (!button || slot === undefined) {
      return;
    }
    event.preventDefault();
    this.skillPointerId = event.pointerId;
    this.skillPointerSlot = slot;
    this.skillPointerElement = button;
    button.setPointerCapture(event.pointerId);
    this.updateSkillAim(event);
    this.queueSlotPress(slot);
  };

  private readonly onSkillPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.skillPointerId) {
      this.updateSkillAim(event);
    }
  };

  private readonly onSkillPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.skillPointerId || this.skillPointerSlot === undefined) {
      return;
    }
    this.updateSkillAim(event);
    this.rememberTouchAim();
    this.queueCast(this.skillPointerSlot);
    this.queueSlotRelease(this.skillPointerSlot);
    this.clearSkillPointer();
  };

  private readonly onSkillPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.skillPointerId) {
      return;
    }
    this.clearSkillPointer();
  };

  private clearFirePointer(): void {
    this.firePointerId = undefined;
    this.firePressed = false;
    this.touchAim = { x: 0, y: 0 };
    this.controls?.fireKnob.style.setProperty('--knob-x', '0px');
    this.controls?.fireKnob.style.setProperty('--knob-y', '0px');
  }

  private clearSkillPointer(): void {
    this.skillPointerId = undefined;
    this.skillPointerSlot = undefined;
    this.skillPointerElement = undefined;
    this.touchAim = { x: 0, y: 0 };
  }

  private updateJoystick(event: PointerEvent): void {
    const stick = this.readPadVector(event, this.controls?.joystick);
    this.touchMove = stick.value;
    this.controls?.joystickKnob.style.setProperty('--knob-x', `${stick.offset.x}px`);
    this.controls?.joystickKnob.style.setProperty('--knob-y', `${stick.offset.y}px`);
  }

  private updateFire(event: PointerEvent): void {
    const stick = this.readPadVector(event, this.controls?.firePad);
    this.touchAim = magnitude(stick.value) > 0.01 ? stick.value : this.lastExplicitAim;
    this.controls?.fireKnob.style.setProperty('--knob-x', `${stick.offset.x}px`);
    this.controls?.fireKnob.style.setProperty('--knob-y', `${stick.offset.y}px`);
  }

  private updateSkillAim(event: PointerEvent): void {
    const stick = this.readPadVector(event, this.skillPointerElement);
    this.touchAim = magnitude(stick.value) > 0.01 ? stick.value : this.lastExplicitAim;
  }

  private rememberTouchAim(): void {
    if (magnitude(this.touchAim) <= 0.01) {
      return;
    }
    this.lastExplicitAim = normalized(this.touchAim);
    this.hasExplicitAim = true;
  }

  private readPadVector(event: PointerEvent, element: HTMLElement | undefined): { value: Vec2; offset: Vec2 } {
    if (!element) {
      return { value: { x: 0, y: 0 }, offset: { x: 0, y: 0 } };
    }
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const max = Math.max(24, Math.min(rect.width, rect.height) * 0.36);
    const raw = {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
    const distance = Math.hypot(raw.x, raw.y);
    const scale = distance > max ? max / distance : 1;
    const offset = { x: raw.x * scale, y: raw.y * scale };
    return {
      value: { x: offset.x / max, y: offset.y / max },
      offset,
    };
  }

  private updateMouseAim(event: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    const origin = this.aimOrigin ?? {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    this.mouseAim = normalized({
      x: event.clientX - origin.x,
      y: event.clientY - origin.y,
    });
  }

  private queueCast(slot: number): void {
    this.queuedCastSlots.push(slot);
  }

  private queueSlotPress(slot: number): void {
    this.queuedSlotPresses.push(slot);
  }

  private queueSlotRelease(slot: number): void {
    this.queuedSlotReleases.push(slot);
  }

  private releasePointerCapture(element: HTMLElement | undefined, pointerId: number | undefined): void {
    if (element && pointerId !== undefined && element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  }

  private drainCastSlots(): number[] {
    const slots = Array.from(new Set(this.queuedCastSlots.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < 4)));
    this.queuedCastSlots = [];
    return slots;
  }

  private drainSlotPresses(): number[] {
    const slots = Array.from(new Set(this.queuedSlotPresses.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < 4)));
    this.queuedSlotPresses = [];
    return slots;
  }

  private drainSlotReleases(): number[] {
    const slots = Array.from(new Set(this.queuedSlotReleases.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < 4)));
    this.queuedSlotReleases = [];
    return slots;
  }
}

function isGameKey(code: string): boolean {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(code);
}

function slotForKey(code: string): number | undefined {
  if (code === 'Space') {
    return 0;
  }
  if (/^Digit[1-4]$/.test(code)) {
    return Number(code.at(-1)) - 1;
  }
  return undefined;
}

function slotFromElement(element: HTMLElement): number | undefined {
  const slot = Number(element.dataset.slot);
  return Number.isInteger(slot) && slot >= 0 && slot < 4 ? slot : undefined;
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}

function magnitude(value: Vec2): number {
  return Math.hypot(value.x, value.y);
}

function normalized(value: Vec2): Vec2 {
  const mag = magnitude(value);
  if (mag < 0.001) {
    return { x: 0, y: 0 };
  }
  return { x: value.x / mag, y: value.y / mag };
}
