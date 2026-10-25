// Runs the edit off the main thread so the sliders stay smooth. Each photo size lives in its own slot
// ("preview", "draft", "thumb", "export"), sent once; each request then only carries the settings.
// Everything is tagged with the photo's id, so nothing from a previous photo (a late analysis, a
// queued render) can mix with the current one.
import type { Settings } from "../settings";
import type { Face, Segmentation } from "../vision";
import { baseKey, finish, renderBase, type Stage } from "./render";

type Source = { token: string; data: Uint8ClampedArray; width: number; height: number };

export type WorkerRequest =
  | { type: "source"; key: string; token: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: "analysis"; token: string; faces: Face[]; seg: Segmentation | null }
  | { type: "release"; key: string }
  | { type: "render"; id: number; key: string; token: string; settings: Settings; encode?: boolean };

export type WorkerResponse =
  | { type: "rendered"; id: number; key: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: "encoded"; id: number; blob: Blob }
  | { type: "error"; id: number; message: string; stale?: boolean };

const sources = new Map<string, Source>();
let analysis: { token: string; faces: Face[]; seg: Segmentation | null; version: number } = { token: "", faces: [], seg: null, version: 0 };
/**
 * Stage one (reshaping, retouch, makeup, hair, background, glasses) per interactive slot: when only
 * light or colour settings change, it is reused and only stage two runs.
 */
const stages = new Map<string, { key: string; stage: Stage }>();
const CACHED = new Set(["preview", "draft"]);

const reply = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "source") {
    sources.set(msg.key, { token: msg.token, data: msg.data, width: msg.width, height: msg.height });
    // A new photo starts with no faces until its own analysis arrives.
    if (msg.key === "preview" && analysis.token !== msg.token) analysis = { token: msg.token, faces: [], seg: null, version: analysis.version + 1 };
    stages.delete(msg.key);
    return;
  }
  if (msg.type === "analysis") {
    if (msg.token === analysis.token) analysis = { token: msg.token, faces: msg.faces, seg: msg.seg, version: analysis.version + 1 };
    return;
  }
  if (msg.type === "release") {
    sources.delete(msg.key);
    stages.delete(msg.key);
    return;
  }
  const src = sources.get(msg.key);
  if (!src || src.token !== msg.token || analysis.token !== msg.token) {
    reply({ type: "error", id: msg.id, message: "La foto cambió", stale: true });
    return;
  }
  try {
    const key = `${msg.token}|${analysis.version}|${baseKey(msg.settings)}`;
    let stage = CACHED.has(msg.key) && stages.get(msg.key)?.key === key ? stages.get(msg.key)!.stage : null;
    if (!stage) {
      stage = renderBase({ data: src.data, width: src.width, height: src.height, faces: analysis.faces, seg: analysis.seg, settings: msg.settings });
      if (CACHED.has(msg.key)) stages.set(msg.key, { key, stage });
    }
    const data = finish(stage, msg.settings, !CACHED.has(msg.key));
    // For a save, encode the JPEG right here when the browser can (OffscreenCanvas): the 12 MP of
    // pixels then never have to travel back to the page and sit in a second canvas.
    if (msg.encode && typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(src.width, src.height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, src.width, src.height), 0, 0);
        canvas
          .convertToBlob({ type: "image/jpeg", quality: 0.95 })
          .then((blob) => reply({ type: "encoded", id: msg.id, blob }))
          .catch(() => reply({ type: "rendered", id: msg.id, key: msg.key, data, width: src.width, height: src.height }, [data.buffer]));
        return;
      }
    }
    reply({ type: "rendered", id: msg.id, key: msg.key, data, width: src.width, height: src.height }, [data.buffer]);
  } catch (err) {
    reply({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
