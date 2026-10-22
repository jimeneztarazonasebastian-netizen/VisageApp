// Runs the edit off the main thread so the sliders stay smooth. The photo is sent once per size;
// each request then only carries the settings.
import type { Settings } from "../settings";
import type { Face, Segmentation } from "../vision";
import { render } from "./render";

type Source = { data: Uint8ClampedArray; width: number; height: number };

export type WorkerRequest =
  | { type: "source"; key: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: "analysis"; faces: Face[]; seg: Segmentation | null }
  | { type: "render"; id: number; key: string; settings: Settings };

export type WorkerResponse = { type: "rendered"; id: number; key: string; data: Uint8ClampedArray; width: number; height: number } | { type: "error"; id: number; message: string };

const sources = new Map<string, Source>();
let faces: Face[] = [];
let seg: Segmentation | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "source") {
    sources.set(msg.key, { data: msg.data, width: msg.width, height: msg.height });
    // Keep the preview and at most one export size.
    if (sources.size > 2) for (const k of sources.keys()) if (k !== "preview" && k !== msg.key) sources.delete(k);
    return;
  }
  if (msg.type === "analysis") {
    faces = msg.faces;
    seg = msg.seg;
    return;
  }
  const src = sources.get(msg.key);
  if (!src) {
    (self as unknown as Worker).postMessage({ type: "error", id: msg.id, message: "sin imagen" } satisfies WorkerResponse);
    return;
  }
  try {
    const data = render({ ...src, faces, seg, settings: msg.settings });
    (self as unknown as Worker).postMessage({ type: "rendered", id: msg.id, key: msg.key, data, width: src.width, height: src.height } satisfies WorkerResponse, [data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
