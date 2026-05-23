import type { PlayerInput } from '../engine/protocol';

type InputListener = (input: PlayerInput) => void;

export type TouchControlElements = {
  root: HTMLElement;
  joystick: HTMLElement;
  joystickKnob: HTMLElement;
  firePad: HTMLElement;
  fireKnob: HTMLElement;
};

type Vec2 = { x: number; y: number };

export class InputController {
  private readonly keys = new Set<string>();
  private readonly listeners = new Set<InputListener>();
  private sequence = 0;
  private mouseAim?: Vec2;
  private mousePrimaryPressed = false;
  private touchMove: Vec2 = { x: 0, y: 0 };
  private touchAim: Vec2 = { x: 0, y: 0 };
  private lastExplicitAim: Vec2 = { x: 1, y: 0 };
  private hasExplicitAim = false;
  private joystickPointerId?: number;
  private firePointerId?: number;
  private firePressed = false;
  private primaryPulse = false;
  private aimOrigin?: Vec2;
  private interval?: number;

  constructor(
    private readonly target: HTMLCanvasElement,
    private readonly controls?: TouchControlElements,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
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
    controls?.firePad.addEventListener('pointercancel', this.onFirePointerUp);
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

  destroy(): void {
    this.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
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
    this.controls?.firePad.removeEventListener('pointercancel', this.onFirePointerUp);
    this.listeners.clear();
  }

  private emit(): void {
    const keyboardX = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const keyboardY = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
    const move = normalized({
      x: keyboardX + this.touchMove.x,
      y: keyboardY + this.touchMove.y,
    });
    const explicitAim = this.firePressed && magnitude(this.touchAim) > 0.01 ? normalized(this.touchAim) : this.mouseAim;
    if (explicitAim && magnitude(explicitAim) > 0.01) {
      this.lastExplicitAim = explicitAim;
      this.hasExplicitAim = true;
    }
    const fallbackAim = this.hasExplicitAim ? this.lastExplicitAim : magnitude(move) > 0.01 ? move : { x: 1, y: 0 };
    const aim = explicitAim ?? fallbackAim;
    const input: PlayerInput = {
      sequence: ++this.sequence,
      moveX: move.x,
      moveY: move.y,
      aimDx: aim.x,
      aimDy: aim.y,
      primaryPressed: this.keys.has('Space') || this.mousePrimaryPressed || this.firePressed || this.primaryPulse,
      sampledAtMs: performance.now(),
    };
    for (const listener of this.listeners) {
      listener(input);
    }
    this.primaryPulse = false;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) {
      return;
    }
    if (isGameKey(event.code)) {
      event.preventDefault();
      if (event.code === 'Space' && !this.keys.has('Space')) {
        this.primaryPulse = true;
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
      this.keys.delete(event.code);
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
    this.mousePrimaryPressed = true;
    this.primaryPulse = true;
    this.target.setPointerCapture(event.pointerId);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }
    this.updateMouseAim(event);
    this.mousePrimaryPressed = false;
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
    this.firePointerId = undefined;
    this.firePressed = false;
    this.touchAim = { x: 0, y: 0 };
    this.controls?.fireKnob.style.setProperty('--knob-x', '0px');
    this.controls?.fireKnob.style.setProperty('--knob-y', '0px');
  };

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
}

function isGameKey(code: string): boolean {
  return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code);
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
