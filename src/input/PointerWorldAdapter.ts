import type { PickedActor } from '../render/CanvasRenderer';

export type PointerWorldIntent =
  | {
      kind: 'moveTo';
      pointerId: number;
      pointerType: string;
      worldX: number;
      worldY: number;
    }
  | {
      kind: 'engage';
      pointerId: number;
      pointerType: string;
      worldX: number;
      worldY: number;
      actor: PickedActor;
    };

type Vec2 = { x: number; y: number };
type PointerWorldListener = (intent: PointerWorldIntent) => void;

export type PointerWorldAdapterOptions = {
  target: HTMLCanvasElement;
  clientToWorld: (clientX: number, clientY: number) => Vec2 | undefined;
  pickActorAtClient?: (clientX: number, clientY: number) => PickedActor | undefined;
};

export class PointerWorldAdapter {
  private readonly listeners = new Set<PointerWorldListener>();

  constructor(private readonly options: PointerWorldAdapterOptions) {
    options.target.addEventListener('pointerdown', this.onPointerDown);
  }

  onIntent(listener: PointerWorldListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.options.target.removeEventListener('pointerdown', this.onPointerDown);
    this.listeners.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const world = this.options.clientToWorld(event.clientX, event.clientY);
    if (!world) {
      return;
    }
    const actor = this.options.pickActorAtClient?.(event.clientX, event.clientY);
    this.emit(
      actor
        ? {
            kind: 'engage',
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            worldX: world.x,
            worldY: world.y,
            actor,
          }
        : {
            kind: 'moveTo',
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            worldX: world.x,
            worldY: world.y,
          },
    );
  };

  private emit(intent: PointerWorldIntent): void {
    for (const listener of this.listeners) {
      listener(intent);
    }
  }
}
