// Runs the edit off the main thread so the sliders stay smooth. Each photo size lives in its own slot
// ("preview", "draft", "thumb", "export"), sent once; each request then only carries the settings.
// Everything is tagged with the photo's id, so nothing from a previous photo (a late analysis, a
// queued render) can mix with the current one.
import type { Settings } from "../settings";
import type { Face, Segmentation } from "../vision";
import { render } from "./render";

type Source = { token: string; data: Uint8ClampedArray; width: number; height: number };

export type WorkerRequest =
  | { type: "source"; key: string; token: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: "analysis"; token: string; faces: Face[]; seg: Segmentation | null }
  | { type: "release"; key: string }
  | { type: "render"; id: number; key: string; token: string; settings: Settings };

export type WorkerResponse =
  | { type: "rendered"; id: number; key: string; data: Uint8ClampedArray; width: number; height: number }
  | { type: "error"; id: number; message: string; stale?: boolean };

const sources = new Map<string, Source>();
let analysis: { token: string; faces: Face[]; seg: Segmentation | null } = { token: "", faces: [], seg: null };

const reply = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "source") {
    sources.set(msg.key, { token: msg.token, data: msg.data, width: msg.width, height: msg.height });
    // A new photo starts with no faces until its own analysis arrives.
    if (msg.key === "preview" && analysis.token !== msg.token) analysis = { token: msg.token, faces: [], seg: null };
    return;
  }
  if (msg.type === "analysis") {
    if (msg.token === analysis.token) analysis = { token: msg.token, faces: msg.faces, seg: msg.seg };
    return;
  }
  if (msg.type === "release") {
    sources.delete(msg.key);
    return;
  }
  const src = sources.get(msg.key);
  if (!src || src.token !== msg.token || analysis.token !== msg.token) {
    reply({ type: "error", id: msg.id, message: "La foto cambió", stale: true });
    return;
  }
  try {
    const data = render({ data: src.data, width: src.width, height: src.height, faces: analysis.faces, seg: analysis.seg, settings: msg.settings });
    reply({ type: "rendered", id: msg.id, key: msg.key, data, width: src.width, height: src.height }, [data.buffer]);
  } catch (err) {
    reply({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
