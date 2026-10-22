// Generates the app icons (PWA, Apple, favicon) from the logo. Run once: node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const out = join(process.cwd(), "public", "icons");
mkdirSync(out, { recursive: true });

// The logo mark: a face outline with a sparkle, on a violet tile.
const mark = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${28 + pad * 2} ${28 + pad * 2}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
  ${pad ? `<rect x="${-pad}" y="${-pad}" width="${28 + pad * 2}" height="${28 + pad * 2}" fill="url(#g)"/>` : ""}
  <rect width="28" height="28" rx="${pad ? 0 : 7}" fill="url(#g)"/>
  <ellipse cx="13" cy="15" rx="6.5" ry="8" fill="none" stroke="#fff" stroke-width="1.8"/>
  <circle cx="10.6" cy="13.6" r="1" fill="#fff"/>
  <circle cx="15.4" cy="13.6" r="1" fill="#fff"/>
  <path d="M10.3 17.4q2.7 2.6 5.4 0" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M21.5 4.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="#fff"/>
</svg>`;

const jobs = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 7], // extra safe area for Android's round/squircle masks
  ["apple-touch-icon.png", 180, 4],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(join(out, name));
}
await sharp(Buffer.from(mark(0))).resize(64, 64).png().toFile(join(process.cwd(), "src", "app", "icon.png"));
console.log("iconos creados en public/icons");
