import { afterEach, describe, expect, it, vi } from 'vitest';
import { WakeLockSession, type WakeLockView } from './wakeLock';

class Sentinel extends EventTarget {
  released = false;
  release = vi.fn(async () => { this.released = true; this.dispatchEvent(new Event('release')); });
}

function setup(request = vi.fn(async () => new Sentinel())) {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { wakeLock: { request } });
  const views: WakeLockView[] = [];
  const session = new WakeLockSession((view) => views.push(view));
  const visibility = (state: string) => { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); };
  return { session, views, request, visibility };
}

afterEach(() => vi.unstubAllGlobals());

describe('screen wake lock ownership', () => {
  it('starts off, acquires by opt-in, and releases on opt-out', async () => {
    const { session, views, request } = setup();
    expect(request).not.toHaveBeenCalled();
    await session.toggle();
    expect(views.at(-1)?.active).toBe(true);
    const sentinel = await request.mock.results[0].value;
    await session.toggle();
    expect(sentinel.release).toHaveBeenCalledOnce();
    expect(views.at(-1)?.active).toBe(false);
    session.destroy();
  });

  it('restores opted-in intent after hide/show, with no duplicate request', async () => {
    const { session, views, request, visibility } = setup();
    await session.toggle();
    visibility('hidden');
    expect(views.at(-1)?.active).toBe(false);
    visibility('visible');
    visibility('visible');
    await vi.waitFor(() => expect(views.at(-1)?.active).toBe(true));
    expect(request).toHaveBeenCalledTimes(2);
    session.destroy();
  });

  it('does not fight a system release while visible', async () => {
    const { session, views, request, visibility } = setup();
    await session.toggle();
    await (await request.mock.results[0].value).release();
    visibility('visible');
    expect(views.at(-1)?.active).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    session.destroy();
  });

  it('reports denial and permits a later user retry', async () => {
    const request = vi.fn(async () => new Sentinel()).mockRejectedValueOnce(new Error('power policy'));
    const { session, views } = setup(request);
    await session.toggle();
    expect(views.at(-1)?.message).toContain('power policy');
    await session.toggle();
    expect(views.at(-1)?.active).toBe(true);
    session.destroy();
  });

  for (const transition of ['destroy', 'hidden', 'opt-out']) {
    it(`releases a late acquisition after ${transition}`, async () => {
      let resolve!: (value: Sentinel) => void;
      const request = vi.fn(() => new Promise<Sentinel>((done) => { resolve = done; }));
      const { session, views, visibility } = setup(request);
      const pending = session.toggle();
      if (transition === 'destroy') session.destroy();
      if (transition === 'hidden') visibility('hidden');
      if (transition === 'opt-out') await session.toggle();
      const count = views.length;
      const sentinel = new Sentinel();
      resolve(sentinel);
      await pending;
      expect(sentinel.release).toHaveBeenCalledOnce();
      expect(views.at(-1)?.active).toBe(false);
      if (transition === 'destroy') expect(views).toHaveLength(count);
      session.destroy();
    });
  }

  it('reports an unsupported capability without requesting it', async () => {
    const { session, views } = setup();
    session.destroy();
    vi.stubGlobal('navigator', {});
    const unsupported = new WakeLockSession((view) => views.push(view));
    await unsupported.toggle();
    expect(views.at(-1)?.supported).toBe(false);
    unsupported.destroy();
  });
});
