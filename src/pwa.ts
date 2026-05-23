export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', window.location.href), { scope: './' }).catch((error: unknown) => {
      console.warn('service worker registration failed', error);
    });
  });
}
