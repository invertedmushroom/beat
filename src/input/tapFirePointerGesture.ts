type Vec2 = { x: number; y: number };

export type TapFirePointerGestureOptions = {
  canvas: HTMLCanvasElement;
  clientToWorld: (clientX: number, clientY: number) => Vec2 | undefined;
  getAimOrigin: () => Vec2 | undefined;
  setExplicitAim: (aim: Vec2) => void;
  pressPrimarySlot: () => void;
  releasePrimarySlot: () => void;
  queueQuickTapFire: (world: Vec2) => void;
  holdDelayMs?: number;
};

/**
 * Binds canvas pointer gestures for tap-fire style profiles.
 *
 * Preserves the current semantics:
 * - quick tap queues a one-shot slot-0 fire towards the tapped world point
 * - hold starts charging slot 0 after a short delay and updates aim while dragging
 * - release ends the charge without changing the existing press/cast/release model
 */
export function installTapFirePointerGesture(options: TapFirePointerGestureOptions): () => void {
  const holdDelayMs = options.holdDelayMs ?? 200;
  let activePointerId: number | undefined;
  let holdTimer: number | undefined;
  let isHolding = false;

  const updateAimFromWorld = (world: Vec2): void => {
    const origin = options.getAimOrigin();
    if (!origin) {
      return;
    }
    const dx = world.x - origin.x;
    const dy = world.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      options.setExplicitAim({ x: dx / dist, y: dy / dist });
    }
  };

  const clearState = (): void => {
    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer);
      holdTimer = undefined;
    }
    activePointerId = undefined;
    isHolding = false;
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    event.preventDefault();
    try {
      options.canvas.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }

    const world = options.clientToWorld(event.clientX, event.clientY);
    if (!world) {
      return;
    }

    activePointerId = event.pointerId;
    isHolding = false;
    holdTimer = window.setTimeout(() => {
      isHolding = true;
      options.pressPrimarySlot();
      updateAimFromWorld(world);
    }, holdDelayMs);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    if (!isHolding) {
      return;
    }
    const world = options.clientToWorld(event.clientX, event.clientY);
    if (!world) {
      return;
    }
    updateAimFromWorld(world);
  };

  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) {
      return;
    }
    event.preventDefault();

    try {
      if (options.canvas.hasPointerCapture(event.pointerId)) {
        options.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }

    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer);
      holdTimer = undefined;
    }

    const world = options.clientToWorld(event.clientX, event.clientY);
    if (world) {
      if (isHolding) {
        updateAimFromWorld(world);
        options.releasePrimarySlot();
      } else {
        options.queueQuickTapFire(world);
      }
    }

    activePointerId = undefined;
    isHolding = false;
  };

  options.canvas.addEventListener('pointerdown', onDown);
  options.canvas.addEventListener('pointermove', onMove);
  options.canvas.addEventListener('pointerup', onUp);
  options.canvas.addEventListener('pointercancel', onUp);

  return () => {
    options.canvas.removeEventListener('pointerdown', onDown);
    options.canvas.removeEventListener('pointermove', onMove);
    options.canvas.removeEventListener('pointerup', onUp);
    options.canvas.removeEventListener('pointercancel', onUp);
    clearState();
  };
}