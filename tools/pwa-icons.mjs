/* global Image, btoa, document */
import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { chromium } from '@playwright/test';

// Rasterize the existing vector mark; keep maskable artwork inside its safe zone.
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, size, inset] of [['icon-180', 180, 0], ['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.18]]) {
    const png = await page.evaluate(async ({ svg, size, inset }) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, size * inset, size * inset, size * (1 - 2 * inset), size * (1 - 2 * inset));
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size, inset });
    await writeFile(new URL(`../public/${name}.png`, import.meta.url), Buffer.from(png, 'base64'));
  }
} finally { await browser.close(); }
