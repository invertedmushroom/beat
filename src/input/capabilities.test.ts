import { describe, expect, it } from 'vitest';
import { detectCapabilities, ModalityTracker } from './capabilities';

describe('detectCapabilities', () => {
  it('classifies fine-only desktops', () => {
    const caps = detectCapabilities({
      matchMedia: queryMatcher({ '(pointer: fine)': true, '(any-pointer: fine)': true }),
      maxTouchPoints: 0,
    });
    expect(caps.primaryPointer).toBe('fine');
    expect(caps.anyFinePointer).toBe(true);
    expect(caps.anyCoarsePointer).toBe(false);
    expect(caps.bucket).toBe('fine-only');
  });

  it('classifies coarse-only phones', () => {
    const caps = detectCapabilities({
      matchMedia: queryMatcher({ '(pointer: coarse)': true, '(any-pointer: coarse)': true }),
      maxTouchPoints: 5,
    });
    expect(caps.primaryPointer).toBe('coarse');
    expect(caps.bucket).toBe('coarse-only');
  });

  it('classifies hybrid touch laptops', () => {
    const caps = detectCapabilities({
      matchMedia: queryMatcher({
        '(pointer: fine)': true,
        '(any-pointer: fine)': true,
        '(any-pointer: coarse)': true,
      }),
      maxTouchPoints: 10,
    });
    expect(caps.bucket).toBe('hybrid');
  });

  it('falls back when no pointer is reported', () => {
    const caps = detectCapabilities({
      matchMedia: queryMatcher({}),
      maxTouchPoints: 0,
    });
    expect(caps.primaryPointer).toBe('none');
    expect(caps.bucket).toBe('none');
  });

  it('treats maxTouchPoints > 0 as a coarse pointer signal', () => {
    const caps = detectCapabilities({
      matchMedia: queryMatcher({ '(pointer: fine)': true, '(any-pointer: fine)': true }),
      maxTouchPoints: 5,
    });
    expect(caps.anyCoarsePointer).toBe(true);
    expect(caps.bucket).toBe('hybrid');
  });
});

describe('ModalityTracker', () => {
  it('notifies listeners only on actual change', () => {
    const tracker = new ModalityTracker('mouse');
    const seen: string[] = [];
    tracker.onChange((m) => seen.push(m));

    tracker.notePointerEvent({ pointerType: 'mouse' });
    tracker.notePointerEvent({ pointerType: 'touch' });
    tracker.notePointerEvent({ pointerType: 'touch' });
    tracker.noteKeyboardEvent();
    tracker.notePointerEvent({ pointerType: 'pen' });

    expect(seen).toEqual(['touch', 'keyboard', 'pen']);
    expect(tracker.current).toBe('pen');
  });
});

function queryMatcher(map: Record<string, boolean>): (query: string) => { matches: boolean } {
  return (query) => ({ matches: !!map[query] });
}
