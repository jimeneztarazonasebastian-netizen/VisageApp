// Copies MediaPipe's WebAssembly runtime into /public/vendor/mediapipe, so the browser loads it from
// our own domain (and the service worker can keep it for offline use).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
const out = join(process.cwd(), "public", "vendor", "mediapipe");
mkdirSync(out, { recursive: true });

const files = readdirSync(src);
for (const name of files) copyFileSync(join(src, name), join(out, name));
console.log(`Motor de visión copiado a public/vendor/mediapipe (${files.length} archivos)`);
