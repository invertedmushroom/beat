import RAPIER from '@dimforge/rapier2d-compat';

let ready: Promise<void> | undefined;

export function initializeRapier(): Promise<void> {
  return ready ??= (async () => {
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('deprecated parameters for the initialization function')) return;
      warn(...args);
    };
    try {
      await RAPIER.init();
    } finally {
      console.warn = warn;
    }
  })();
}
