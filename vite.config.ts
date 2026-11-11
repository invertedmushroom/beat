import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

function deviceHttps(mode: string) {
  if (mode !== 'device-https') return undefined;
  const key = process.env.BEAT_HTTPS_KEY_PATH;
  const cert = process.env.BEAT_HTTPS_CERT_PATH;
  if (!key || !cert) throw new Error('Set BEAT_HTTPS_KEY_PATH and BEAT_HTTPS_CERT_PATH to TLS files trusted by your phone.');
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src/pwa',
    filename: 'sw.ts',
    injectRegister: false,
    manifest: false,
    includeAssets: [],
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,wasm,png,svg,webmanifest}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
  })],
  server: {
    port: 5177,
    strictPort: false,
    https: deviceHttps(mode),
  },
  preview: {
    port: 4177,
    strictPort: false,
    https: deviceHttps(mode),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts', 'spacetimedb/src/**/*.test.ts'],
  },
}));
