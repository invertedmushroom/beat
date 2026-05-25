import type { Ruleset } from '../engine/protocol';

export type Vec2 = { x: number; y: number };

export type CameraState = {
  x: number;
  y: number;
  zoom: number;
  scale: number;
  originX: number;
  originY: number;
  viewportWidth: number;
  viewportHeight: number;
};

export function createCameraState(
  ruleset: Ruleset,
  viewportWidth: number,
  viewportHeight: number,
  target: Vec2 | undefined,
  zoom: number,
): CameraState {
  const baseScale = Math.min(viewportWidth / (ruleset.arena.width + 4), viewportHeight / (ruleset.arena.height + 4));
  const scale = Math.max(0.001, baseScale * Math.max(0.1, zoom));
  const center = clampCameraCenter(ruleset, viewportWidth, viewportHeight, scale, target ?? { x: 0, y: 0 });
  return {
    x: center.x,
    y: center.y,
    zoom,
    scale,
    originX: viewportWidth / 2 - center.x * scale,
    originY: viewportHeight / 2 - center.y * scale,
    viewportWidth,
    viewportHeight,
  };
}

export function worldToViewport(camera: CameraState, x: number, y: number): Vec2 {
  return {
    x: camera.originX + x * camera.scale,
    y: camera.originY + y * camera.scale,
  };
}

export function viewportToWorld(camera: CameraState, x: number, y: number): Vec2 {
  return {
    x: (x - camera.originX) / camera.scale,
    y: (y - camera.originY) / camera.scale,
  };
}

export function isCircleVisible(camera: CameraState, x: number, y: number, radius: number, padding = 2): boolean {
  const screen = worldToViewport(camera, x, y);
  const scaledRadius = (radius + padding) * camera.scale;
  return (
    screen.x >= -scaledRadius &&
    screen.x <= camera.viewportWidth + scaledRadius &&
    screen.y >= -scaledRadius &&
    screen.y <= camera.viewportHeight + scaledRadius
  );
}

function clampCameraCenter(ruleset: Ruleset, viewportWidth: number, viewportHeight: number, scale: number, target: Vec2): Vec2 {
  const visibleWidth = viewportWidth / scale;
  const visibleHeight = viewportHeight / scale;
  return {
    x: clampAxis(target.x, ruleset.arena.width, visibleWidth),
    y: clampAxis(target.y, ruleset.arena.height, visibleHeight),
  };
}

function clampAxis(value: number, worldSize: number, visibleSize: number): number {
  if (visibleSize >= worldSize) {
    return 0;
  }
  const halfRange = worldSize / 2 - visibleSize / 2;
  return Math.max(-halfRange, Math.min(halfRange, value));
}
