// Main-thread side of the engine worker. Preview renders are "latest wins": while one is running,
// newer settings replace any queued request instead of piling up, and results arrive in order.
import type { Settings } from "../settings";
import type { Face, Segmentation } from "../vision";
import type { WorkerRequest, WorkerResponse } from "./engine.worker";

type Pending = { resolve: (v: ImageData | Blob) => void; reject: (e: Error) => void };
type Job = { key: string; token: string; settings: Settings; resolve: (v: ImageData | null) => void };

/** Thrown for renders of a photo that is no longer the current one. */
export class StaleError extends Error {}

export class Engine {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private busy = false;
  private queued: Job | null = null;

  constructor() {
    this.worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === "error") p.reject(msg.stale ? new StaleError(msg.message) : new Error(msg.message));
      else if (msg.type === "encoded") p.resolve(msg.blob);
      else p.resolve(new ImageData(new Uint8ClampedArray(msg.data.buffer as ArrayBuffer), msg.width, msg.height));
    };
    // If the worker itself fails, fail every request instead of leaving the editor waiting forever.
    this.worker.onerror = () => {
      for (const p of this.pending.values()) p.reject(new Error("El motor de edición dejó de responder. Recarga la app."));
      this.pending.clear();
    };
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  /** Hands the pixels to the worker; `image` is unusable afterwards (its buffer is transferred). */
  setSource(key: string, token: string, image: ImageData) {
    const data = image.data;
    this.post({ type: "source", key, token, data, width: image.width, height: image.height }, [data.buffer]);
  }

  setAnalysis(token: string, faces: Face[], seg: Segmentation | null) {
    this.post({ type: "analysis", token, faces, seg });
  }

  /** Frees a slot's pixels (thumbnails and export are only needed for a moment). */
  release(key: string) {
    this.post({ type: "release", key });
  }

  private request(key: string, token: string, settings: Settings, encode: boolean): Promise<ImageData | Blob> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "render", id, key, token, settings, encode });
    });
  }

  render(key: string, token: string, settings: Settings): Promise<ImageData> {
    return this.request(key, token, settings, false) as Promise<ImageData>;
  }

  /** Renders for saving: a JPEG when the worker can encode it, otherwise the pixels. */
  renderForSave(key: string, token: string, settings: Settings): Promise<ImageData | Blob> {
    return this.request(key, token, settings, true);
  }

  /** Renders into a preview slot; resolves null when superseded, stale or failed. */
  preview(key: string, token: string, settings: Settings): Promise<ImageData | null> {
    return new Promise((resolve) => {
      const job: Job = { key, token, settings, resolve };
      if (this.busy) {
        this.queued?.resolve(null);
        this.queued = job;
        return;
      }
      this.run(job);
    });
  }

  private run(job: Job) {
    this.busy = true;
    this.render(job.key, job.token, job.settings)
      .then(job.resolve, () => job.resolve(null))
      .finally(() => {
        const next = this.queued;
        this.queued = null;
        if (next) this.run(next);
        else this.busy = false;
      });
  }
}

let shared: Engine | undefined;
/** One worker for the whole session; it keeps the current photo between edits. */
export const getEngine = () => (shared ??= new Engine());
