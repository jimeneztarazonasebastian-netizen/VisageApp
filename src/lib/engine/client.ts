// Main-thread side of the engine worker. Preview renders are "latest wins": while one is running,
// newer settings replace any queued request instead of piling up.
import type { Settings } from "../settings";
import type { Face, Segmentation } from "../vision";
import type { WorkerRequest, WorkerResponse } from "./engine.worker";

type Pending = { resolve: (v: ImageData) => void; reject: (e: Error) => void };

export class Engine {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private busy = false;
  private queued: { settings: Settings; resolve: (v: ImageData | null) => void } | null = null;

  constructor() {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(new ImageData(new Uint8ClampedArray(msg.data.buffer as ArrayBuffer), msg.width, msg.height));
    };
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  /** Hands the pixels to the worker; `image` is unusable afterwards (its buffer is transferred). */
  setSource(key: string, image: ImageData) {
    const data = image.data;
    this.post({ type: "source", key, data, width: image.width, height: image.height }, [data.buffer]);
  }

  setAnalysis(faces: Face[], seg: Segmentation | null) {
    this.post({ type: "analysis", faces, seg });
  }

  render(key: string, settings: Settings): Promise<ImageData> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "render", id, key, settings });
    });
  }

  /** Renders the preview; resolves null when a newer request superseded this one. */
  preview(settings: Settings): Promise<ImageData | null> {
    if (this.busy) {
      this.queued?.resolve(null);
      return new Promise((resolve) => (this.queued = { settings, resolve }));
    }
    this.busy = true;
    const run = (s: Settings): Promise<ImageData> =>
      this.render("preview", s).finally(() => {
        const q = this.queued;
        this.queued = null;
        if (q) run(q.settings).then(q.resolve, () => q.resolve(null));
        else this.busy = false;
      });
    return run(settings);
  }

}

let shared: Engine | undefined;
/** One worker for the whole session; it keeps the current photo between edits. */
export const getEngine = () => (shared ??= new Engine());
