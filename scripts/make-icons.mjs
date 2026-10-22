// Generates the app icons (PWA, Apple, favicon) from the logo. Run once: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const out = join(process.cwd(), "public", "icons");
mkdirSync(out, { recursive: true });

// The mark: a V whose left arm is a face in profile looking into the V, with a sparkle.
const MARK = `
  <path fill="url(#ink)" d="M 96 104 L 150 104 C 162 128 170 150 172 172 C 173 184 168 192 170 200 C 186 222 206 240 224 252
    C 230 257 226 264 216 266 L 204 268 C 208 276 210 282 206 288 C 210 294 211 300 206 306 C 204 314 208 322 214 330
    C 222 344 236 362 256 384 L 256 420 L 236 420 Z"/>
  <path fill="url(#ink)" d="M 256 420 L 256 384 L 362 104 L 416 104 L 276 420 Z"/>
  <path fill="#fff" d="M 268 150 l 6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 z"/>
  <circle cx="300" cy="206" r="5" fill="#fff" opacity=".7"/>`;

/** `radius` 0 gives a full-bleed square (iOS and Android mask it themselves); `scale` shrinks the mark. */
const icon = ({ radius = 112, scale = 1 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a0b2e"/><stop offset="1" stop-color="#0a0612"/></linearGradient>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="120" y1="104" x2="300" y2="420">
      <stop offset="0" stop-color="#ffd3e8"/><stop offset="0.45" stop-color="#ff5fa8"/><stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="#ff5fa8" stop-opacity=".28"/><stop offset="1" stop-color="#ff5fa8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#glow)"/>
  <g transform="translate(256 262) scale(${scale}) translate(-256 -262)">${MARK}</g>
</svg>`;

const jobs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-512.png", 512, { radius: 0, scale: 0.78 }], // safe area for Android's round/squircle masks
  ["apple-touch-icon.png", 180, { radius: 0, scale: 0.9 }], // iOS rounds the corners itself
];
for (const [name, size, opts] of jobs) await sharp(Buffer.from(icon(opts))).resize(size, size).png().toFile(join(out, name));
await sharp(Buffer.from(icon())).resize(64, 64).png().toFile(join(process.cwd(), "src", "app", "icon.png"));
writeFileSync(join(out, "logo.svg"), icon());
console.log("iconos creados en public/icons");
