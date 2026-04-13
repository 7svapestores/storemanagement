// One-shot icon generator. Renders a simple "7S" badge SVG to PNGs at the
// sizes a PWA needs. Commit the output files; this script is only run when
// the brand mark changes.
//
//   node scripts/make-icons.mjs

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = resolve(__dirname, '..', 'public');
mkdirSync(pub, { recursive: true });

function svg(size, { padded = false } = {}) {
  // Maskable icons need a ~20% safe-area padding so the "7S" isn't clipped
  // when the OS rounds the edges.
  const bg = '#1E40AF';
  const fg = '#FFFFFF';
  const cornerRadius = padded ? size * 0.0 : size * 0.22; // maskable = full bleed
  const inset = padded ? size * 0.12 : 0;
  const textSize = (size - inset * 2) * 0.5;
  const cy = size / 2 + textSize * 0.33;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}"
        rx="${cornerRadius}" ry="${cornerRadius}" fill="${bg}"/>
  <text x="50%" y="${cy}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-weight="900" font-size="${textSize}" fill="${fg}">7S</text>
</svg>`;
}

async function render(size, name, opts = {}) {
  const buf = Buffer.from(svg(size, opts));
  const out = resolve(pub, name);
  await sharp(buf).png().toFile(out);
  console.log('wrote', name);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-512-maskable.png', { padded: true });
await render(180, 'apple-touch-icon.png');
await render(32, 'favicon.png');

// Also dump the SVG source for anyone who wants to inspect or tweak it.
writeFileSync(resolve(pub, 'icon.svg'), svg(512));
console.log('wrote icon.svg');
