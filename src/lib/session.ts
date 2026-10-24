// The edit in progress, kept in IndexedDB on the phone so it survives iOS unloading the app: the
// original photo, the AI results built on it, and the current settings. Images and settings are
// stored separately, so moving a slider doesn't rewrite megabytes of photos.
import type { Settings } from "./settings";

export type AiEdit = { group: string; label: string };

type StoredImages = { name: string; images: Blob[] };
type StoredState = { edits: AiEdit[]; settings: Settings; thumb: string; updated: number };
export type StoredSession = StoredImages & StoredState;

const DB = "visage";
const STORE = "session";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

// Storage can fail (private mode, full disk): editing still works, it just won't be restorable.

/** The original first, then one image per AI edit. Call when the list of images changes. */
export async function saveImages(name: string, images: Blob[]) {
  try {
    await tx("readwrite", (st) => st.put({ name, images } satisfies StoredImages, "images"));
  } catch {}
}

export async function saveState(state: StoredState) {
  try {
    await tx("readwrite", (st) => st.put(state, "state"));
  } catch {}
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const images = (await tx<StoredImages>("readonly", (st) => st.get("images"))) ?? null;
    const state = (await tx<StoredState>("readonly", (st) => st.get("state"))) ?? null;
    if (!images?.images?.length || !state) return null;
    return { ...images, ...state };
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    await tx("readwrite", (st) => {
      st.delete("images");
      st.delete("state");
    });
  } catch {}
}

/** Asks iOS not to evict the stored session under storage pressure (best effort). */
export function persistStorage() {
  navigator.storage?.persist?.().catch(() => {});
}
