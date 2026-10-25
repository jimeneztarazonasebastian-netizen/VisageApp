// Copies MediaPipe's WebAssembly runtime into /public/vendor/mediapipe/<version>, so the browser
// loads it from our own domain and an update never mixes with a cached older copy. Also writes the
// list of files the service worker should keep for offline use (public/vendor/precache.json).
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const vendor = join(process.cwd(), "public", "vendor");
const out = join(vendor, "mediapipe", version);
rmSync(join(vendor, "mediapipe"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const files = readdirSync(join(pkgDir, "wasm"));
for (const name of files) copyFileSync(join(pkgDir, "wasm", name), join(out, name));

// What the app needs to open and analyse a face without a connection (the hair/background model
// is cached the first time it is used).
const precache = [
  ...files.filter((f) => f.startsWith("vision_wasm_internal")).map((f) => `/vendor/mediapipe/${version}/${f}`),
  "/models/face_landmarker.task",
];
writeFileSync(join(vendor, "precache.json"), JSON.stringify({ version, files: precache }, null, 2));
console.log(`Motor de visión ${version} copiado a public/vendor/mediapipe/${version} (${files.length} archivos)`);
