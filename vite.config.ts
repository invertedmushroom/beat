import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    port: 5177,
    strictPort: false,
  },
  preview: {
    port: 4177,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
