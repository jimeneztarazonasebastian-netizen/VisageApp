"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { blendIntoPhoto, cropCanvas, headCrop, loadImage } from "@/lib/ai-blend";
import { AI_GROUPS, AI_PRESETS } from "@/lib/ai-presets";
import { getEngine, StaleError } from "@/lib/engine/client";
import { needsSegmentation } from "@/lib/engine/render";
import { drawScaled, exportCanvas, loadPhoto, pixels, toBlob, type Photo } from "@/lib/photo";
import { clearSession, loadSession, persistStorage, saveImages, saveState, type AiEdit, type StoredSession } from "@/lib/session";
import { applyLook, CATEGORIES, DEFAULTS, LOOKS, num, str, type Settings } from "@/lib/settings";
import { ASPECTS, describe, isIdentity, NO_TRANSFORM, transformPhoto, type Transform } from "@/lib/transform";
import { detectFaces, preloadFaces, segment, type Face, type Segmentation } from "@/lib/vision";
import { Controls, Slider } from "./Controls";
import { Icon } from "./Icon";
import { Viewer } from "./Viewer";

type Saved = { url: string; file: File };
/** Everything that defines the edit: the photos (original first, then one per AI edit or crop) and the sliders. */
type Doc = { bases: Photo[]; edits: AiEdit[]; settings: Settings };
type Start = Doc & { key: string; fromCamera: boolean };
type Analysis = { faces: Face[]; seg: Segmentation | null; failed: boolean; segFailed: boolean };

/** While settings keep changing, the preview shows quick frames at this size… */
const DRAFT_EDGE = 720;
/** …and the full-quality preview once they've been still for this long. */
const SETTLE_MS = 250;
const CROP = "recorte";

export function App() {
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    preloadFaces();
    persistStorage();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
    // iOS ignores user-scalable=no: block the page-level pinch so only the photo zooms.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    return () => document.removeEventListener("gesturestart", stop);
  }, []);

  const open = async (file: File | undefined, fromCamera = false) => {
    if (!file) return;
    setError("");
    try {
      const p = await loadPhoto(file);
      setStart({ key: p.id, bases: [p], edits: [], settings: DEFAULTS, fromCamera });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = async (s: StoredSession) => {
    setRestoring(true);
    setError("");
    try {
      const bases: Photo[] = [];
      for (const b of s.images) bases.push(await loadPhoto(new File([b], `${s.name}.jpg`, { type: b.type || "image/jpeg" })));
      setStart({ key: bases[0].id, bases, edits: s.edits.slice(0, bases.length - 1), settings: { ...DEFAULTS, ...s.settings }, fromCamera: false });
    } catch {
      setError("No se pudo recuperar la edición anterior.");
      await clearSession();
    } finally {
      setRestoring(false);
    }
  };

  if (!start) return <Home onFile={open} onRestore={restore} restoring={restoring} error={error} />;
  return <Editor key={start.key} start={start} onClose={() => setStart(null)} onFile={(f) => open(f)} />;
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function Home({ onFile, onRestore, restoring, error }: { onFile: (f: File | undefined, fromCamera?: boolean) => void; onRestore: (s: StoredSession) => void; restoring: boolean; error: string }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  useEffect(() => {
    loadSession().then(setSession);
  }, []);

  return (
    <main className="safe flex min-h-dvh flex-col bg-black text-white">
      <div className="flex flex-1 flex-col items-center justify-between px-6 py-10">
        <div className="mt-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo.svg" alt="" className="h-24 w-24 rounded-[26px] shadow-[0_12px_48px_rgba(255,95,168,.35)]" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight">Visage</h1>
          <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-white/60">Edad, género, sonrisa, retoque, forma de la cara, maquillaje, gafas, cabello, fondo y filtros.</p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-3">
          {error && <p className="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{error}</p>}
          {session && (
            <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60" onClick={() => onRestore(session)} disabled={restoring}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={session.thumb} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                <span className="min-w-0">
                  <span className="block font-medium">{restoring ? "Recuperando…" : "Continuar edición"}</span>
                  <span className="block truncate text-xs text-white/55">
                    {session.name} · {ago(session.updated)}
                  </span>
                </span>
              </button>
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/50"
                aria-label="Descartar la edición guardada"
                onClick={() => {
                  clearSession();
                  setSession(null);
                }}
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-4 text-lg font-medium shadow-lg shadow-fuchsia-900/40 active:scale-[.98]">
            <Icon name="image" />
            Elegir foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl bg-white/10 py-4 text-lg font-medium active:scale-[.98]">
            <Icon name="camera" />
            Tomar selfie
            <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => onFile(e.target.files?.[0], true)} />
          </label>
          <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-white/45">
            <Icon name="lock" className="h-3.5 w-3.5" />
            Se edita en tu teléfono. Solo las opciones de IA envían la foto a Gemini.
          </p>
        </div>
      </div>
    </main>
  );
}

function Editor({ start, onClose, onFile }: { start: Start; onClose: () => void; onFile: (f: File | undefined) => void }) {
  const engine = getEngine();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Doc>(start);
  const { bases, edits, settings } = doc;
  const original = bases[0];
  const photo = bases[bases.length - 1];
  // Latest values for event handlers and async callbacks (kept in sync after each render).
  const docRef = useRef(doc);
  const photoRef = useRef(photo);
  useLayoutEffect(() => {
    docRef.current = doc;
    photoRef.current = photo;
  }, [doc, photo]);
  const mounted = useRef(true);

  /** Faces and masks per photo: undoing an AI edit or a crop doesn't analyse the photo again. */
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const analysesRef = useRef(analyses);
  useLayoutEffect(() => {
    analysesRef.current = analyses;
  }, [analyses]);
  const current = analyses[photo.id];
  const faces = current ? current.faces : null;
  const [faceRetry, setFaceRetry] = useState(0);
  const segInflight = useRef(new Set<string>());

  const [category, setCategory] = useState("looks");
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const [split, setSplit] = useState<number | null>(null);
  const splitRef = useRef<number | null>(null);
  const [toast, setToast] = useState("");
  const [thumbs, setThumbs] = useState<{ id: string; map: Record<string, string> }>({ id: "", map: {} });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedDoc, setSavedDoc] = useState<Doc | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{ message: string; retry: () => void } | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  /** The last frame painted (shown again after comparing). */
  const shown = useRef<{ img: ImageData; draft: boolean } | null>(null);
  const draftCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      aiAbort.current?.abort();
    };
  }, []);

  // ───────── history (sliders, looks, crops and AI edits all undo the same way) ─────────
  const hist = useRef<{ list: Doc[]; index: number }>({ list: [start], index: 0 });
  const [histPos, setHistPos] = useState({ index: 0, length: 1 });
  const sameDoc = (a: Doc, b: Doc) => a.bases === b.bases && same(a.settings, b.settings);
  const syncHist = () => setHistPos({ index: hist.current.index, length: hist.current.list.length });
  const push = (d: Doc) => {
    const h = hist.current;
    if (sameDoc(d, h.list[h.index])) return;
    h.list = [...h.list.slice(0, h.index + 1), d].slice(-60);
    h.index = h.list.length - 1;
    syncHist();
  };
  const apply = (d: Doc) => {
    docRef.current = d;
    setDoc(d);
    push(d);
  };
  const change = (patch: Settings) => setDoc((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  // Sliders change the settings live; the history only records where they were released.
  const commit = () => window.setTimeout(() => push(docRef.current));
  const goTo = (i: number) => {
    const h = hist.current;
    if (i < 0 || i >= h.list.length) return;
    h.index = i;
    docRef.current = h.list[i];
    setDoc(h.list[i]);
    syncHist();
  };

  // ───────── analysis: faces once per photo, hair/background masks when needed ─────────
  useEffect(() => {
    let cancelled = false;
    const token = photo.id;
    const { width: w, height: h } = photo.preview;
    engine.setSource("preview", token, pixels(photo.preview));
    engine.setSource("draft", token, pixels(drawScaled(photo.preview, w, h, DRAFT_EDGE)));
    const c = canvas.current!;
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(photo.preview, 0, 0);
    shown.current = null;

    const cached = analysesRef.current[token];
    if (cached) {
      engine.setAnalysis(token, cached.faces, cached.seg);
      return;
    }
    // A download that never finishes must not leave "Analizando el rostro…" up forever.
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 25_000));
    Promise.race([detectFaces(photo.preview), timeout])
      .then((f) => {
        engine.setAnalysis(token, f, null);
        setAnalyses((a) => ({ ...a, [token]: { faces: f, seg: null, failed: false, segFailed: false } }));
        if (!cancelled && !f.length) setToast("No encontré ninguna cara. Puedes usar filtros, ajustes y fondo.");
      })
      .catch(() => {
        // Not "no face": the detector itself failed (no connection the first time, an iOS hiccup).
        // Filters and adjustments still work meanwhile; the badge offers to try again.
        engine.setAnalysis(token, [], null);
        setAnalyses((a) => ({ ...a, [token]: { faces: [], seg: null, failed: true, segFailed: false } }));
      });
    return () => {
      cancelled = true;
    };
  }, [engine, photo, faceRetry]);

  // Small pictures of each face, for choosing which one to edit when there are several.
  const faceThumbs = useMemo(() => {
    if (!faces || faces.length < 2) return [];
    const src = photo.preview;
    return faces.map((f) => {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of f) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      const side = Math.max((x1 - x0) * src.width, (y1 - y0) * src.height) * 1.3;
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      c.getContext("2d")!.drawImage(src, ((x0 + x1) / 2) * src.width - side / 2, ((y0 + y1) / 2) * src.height - side / 2, side, side, 0, 0, 64, 64);
      return c.toDataURL("image/jpeg", 0.8);
    });
  }, [faces, photo]);

  // Hair, background and skin retouch use the segmentation model (about 16 MB), loaded when needed.
  const wantsSeg = needsSegmentation(settings) || !!CATEGORIES.find((c) => c.id === category)?.needsSegmentation;
  const segLoading = !!(wantsSeg && current && !current.seg && !current.segFailed);
  useEffect(() => {
    if (!wantsSeg || !current || current.seg || current.segFailed || segInflight.current.has(photo.id)) return;
    const p = photo;
    const f = current.faces;
    segInflight.current.add(p.id);
    segment(p.preview, f)
      .then((s) => {
        engine.setAnalysis(p.id, f, s); // ignored by the engine if the photo changed meanwhile
        setAnalyses((a) => (a[p.id] ? { ...a, [p.id]: { ...a[p.id], seg: s } } : a));
      })
      .catch(() => {
        setAnalyses((a) => (a[p.id] ? { ...a, [p.id]: { ...a[p.id], segFailed: true } } : a));
        if (mounted.current) setToast("No se pudo cargar el modelo de cabello y fondo. Vuelve a abrir Cabello o Fondo para reintentar.");
      })
      .finally(() => segInflight.current.delete(p.id));
  }, [wantsSeg, current, photo, engine]);

  // ───────── preview ─────────
  /** What "before" means: the photo as opened (or as cropped, so the two line up). */
  const compareBase = useMemo(() => {
    for (let i = edits.length - 1; i >= 0; i--) if (edits[i].group === CROP) return bases[i + 1];
    return original;
  }, [bases, edits, original]);
  const compareRef = useRef(compareBase);
  useLayoutEffect(() => {
    compareRef.current = compareBase;
  }, [compareBase]);

  const paint = useCallback((img: ImageData, draft: boolean) => {
    shown.current = { img, draft };
    const c = canvas.current;
    if (holdingRef.current || !c) return;
    const ctx = c.getContext("2d")!;
    if (img.width === c.width && img.height === c.height) ctx.putImageData(img, 0, 0);
    else {
      const t = (draftCanvas.current ??= document.createElement("canvas"));
      t.width = img.width;
      t.height = img.height;
      t.getContext("2d")!.putImageData(img, 0, 0);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(t, 0, 0, c.width, c.height);
    }
    // Split view: the "before" on the left of the divider.
    const s = splitRef.current;
    if (s !== null) {
      const x = Math.round(s * c.width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, c.height);
      ctx.clip();
      drawFit(ctx, compareRef.current.preview);
      ctx.restore();
      const lw = Math.max(2, c.width / 260);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - lw / 2, 0, lw, c.height);
      ctx.beginPath();
      ctx.arc(x, c.height / 2, lw * 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = `${Math.round(lw * 7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("‹ ›", x, c.height / 2);
    }
  }, []);

  useEffect(() => {
    if (!current) return;
    const token = photo.id;
    const show = (draft: boolean) => (img: ImageData | null) => {
      if (img && photoRef.current.id === token) paint(img, draft);
    };
    // Every change gets a quick small frame, so the photo follows the finger while dragging; the
    // full-quality frame comes once the settings stop changing for a moment.
    engine.preview("draft", token, settings).then(show(true));
    const t = window.setTimeout(() => engine.preview("preview", token, settings).then(show(false)), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [settings, current, photo, engine, paint]);

  const repaint = useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    if (shown.current) paint(shown.current.img, shown.current.draft);
    else ctx.drawImage(photoRef.current.preview, 0, 0);
  }, [paint]);

  const hold = useCallback(
    (h: boolean) => {
      holdingRef.current = h;
      setHolding(h);
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      if (h) drawFit(ctx, compareRef.current.preview);
      else repaint();
    },
    [repaint],
  );

  const setSplitAt = (s: number | null) => {
    splitRef.current = s;
    setSplit(s);
    repaint();
  };

  // Look thumbnails: the face rendered with each look, cropped around the first face.
  useEffect(() => {
    if (!faces?.length) return;
    let cancelled = false;
    const token = photo.id;
    (async () => {
      const small = drawScaled(photo.preview, photo.preview.width, photo.preview.height, 420);
      engine.setSource("thumb", token, pixels(small));
      const f = faces[0];
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of f) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      const side = Math.max((x1 - x0) * small.width, (y1 - y0) * small.height) * 1.25;
      const cx = ((x0 + x1) / 2) * small.width, cy = ((y0 + y1) / 2) * small.height;
      const out = document.createElement("canvas");
      out.width = out.height = 120;
      const tmp = document.createElement("canvas");
      tmp.width = small.width;
      tmp.height = small.height;
      const map: Record<string, string> = {};
      for (const look of [{ id: "", settings: {} }, ...LOOKS]) {
        const img = await engine.render("thumb", token, { ...DEFAULTS, ...look.settings, desenfoque: 0 });
        if (cancelled) return;
        tmp.getContext("2d")!.putImageData(img, 0, 0);
        out.getContext("2d")!.drawImage(tmp, cx - side / 2, cy - side / 2, side, side, 0, 0, 120, 120);
        map[look.id] = out.toDataURL("image/jpeg", 0.85);
        setThumbs({ id: token, map: { ...map } });
      }
      engine.release("thumb");
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [faces, photo, engine]);
  const lookThumbs = thumbs.id === photo.id ? thumbs.map : {};

  // ───────── session: keep the edit on the phone so it survives iOS closing the app ─────────
  useEffect(() => {
    saveImages(original.name, bases.map((b) => b.file));
  }, [bases, original]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const c = canvas.current;
      const thumb = c && c.width ? drawScaled(c, c.width, c.height, 160).toDataURL("image/jpeg", 0.7) : "";
      saveState({ edits, settings, thumb, updated: Date.now() });
    }, 800);
    return () => window.clearTimeout(t);
  }, [edits, settings, bases]);

  const dirty = !(savedDoc && sameDoc(savedDoc, doc)) && !(bases.length === 1 && same(settings, DEFAULTS));
  const close = async () => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    await clearSession();
    onClose();
  };

  // ───────── looks ─────────
  const pickLook = (id: string) => apply({ ...docRef.current, settings: applyLook(docRef.current.settings, id, 100) });
  const activeLook = str(settings, "look");

  /** Replaces (or adds) the photo the edits build on, keeping the original plus the last 7. */
  const replaceBase = (source: Photo, next: Photo, edit: AiEdit) => {
    const now = docRef.current;
    const at = now.bases.indexOf(source);
    if (at < 0 || !mounted.current) return; // undone meanwhile
    let nb = [...now.bases.slice(0, at + 1), next];
    let ne = [...now.edits.slice(0, at), edit];
    if (nb.length > 8) {
      nb = [nb[0], ...nb.slice(-7)];
      ne = ne.slice(-7);
    }
    apply({ bases: nb, edits: ne, settings: now.settings });
  };
  /** The photo a new edit of `group` starts from: the same group replaces its previous result. */
  const sourceFor = (group: string) => {
    const cur = docRef.current;
    const replace = group !== "custom" && cur.edits[cur.edits.length - 1]?.group === group;
    return cur.bases[cur.bases.length - (replace ? 2 : 1)];
  };
  const chosenFace = (p: Photo) => {
    const fs = analysesRef.current[p.id]?.faces ?? [];
    const i = num(docRef.current.settings, "cara");
    return fs[i > 0 ? i : 0];
  };

  // ───────── crop, rotate, flip ─────────
  const top = edits[edits.length - 1];
  const cropNow: Transform = top?.group === CROP && top.params ? top.params : NO_TRANSFORM;
  const applyCrop = async (t: Transform) => {
    if (busy) return;
    const source = sourceFor(CROP);
    const cur = docRef.current;
    if (isIdentity(t)) {
      // Back to no crop: just drop the crop result if it's the last edit.
      if (cur.edits[cur.edits.length - 1]?.group === CROP) apply({ ...cur, bases: cur.bases.slice(0, -1), edits: cur.edits.slice(0, -1) });
      return;
    }
    setBusy("Aplicando…");
    try {
      const face = chosenFace(source);
      let focus: { x: number; y: number } | undefined;
      if (face) {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const p of face) {
          x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        }
        focus = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      }
      const blob = await transformPhoto(source, t, focus);
      const next = await loadPhoto(new File([blob], `${original.name}.jpg`, { type: "image/jpeg" }));
      replaceBase(source, next, { group: CROP, label: describe(t), params: t });
    } catch {
      setToast("No se pudo aplicar el recorte.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  // ───────── AI ─────────
  const runAi = async (req: { preset?: string; custom?: string }, label: string, group: string) => {
    if (aiAbort.current) return;
    // A new choice in the same group (60 → 80 years, long → short hair) replaces the previous one
    // instead of being generated on top of it.
    const source = sourceFor(group);
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    setAi(label);
    setAiError(null);
    let lock: WakeLockSentinel | null = null;
    try {
      // Keep the screen on: if the phone locks or you switch apps, iOS cuts the request.
      lock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {}
    try {
      // Head-only edits: send a crop around the chosen face and blend the result back into the
      // full-resolution photo (the rest of the picture keeps its pixels and the photo its size).
      const scope = req.preset ? (AI_PRESETS[req.preset]?.scope ?? "face") : "full";
      const face = scope === "face" ? chosenFace(source) : undefined;
      const crop = face ? headCrop(face, source.width, source.height) : null;
      const src = crop ? cropCanvas(source.image, crop, 1536) : drawScaled(source.image, source.width, source.height, 1536);
      const image = await blobToBase64(await toBlob(src, "image/jpeg", 0.92));
      let password = "";
      try {
        password = localStorage.getItem("visage-clave") ?? "";
      } catch {}
      const res = await fetch("/api/ia", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-password": password },
        body: JSON.stringify({ image, mime: "image/jpeg", width: src.width, height: src.height, ...req }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: { image?: string; mime?: string; error?: string } = {};
      try {
        json = JSON.parse(text);
      } catch {}
      if (res.status === 401) setNeedPassword(true);
      if (!res.ok || !json.image) throw new Error(json.error || httpMessage(res.status));
      const bytes = Uint8Array.from(atob(json.image), (c) => c.charCodeAt(0));
      let out: Blob = new Blob([bytes], { type: json.mime || "image/jpeg" });
      if (crop) out = await blendIntoPhoto(source.image, source.width, source.height, crop, await loadImage(out));
      const next = await loadPhoto(new File([out], `${original.name}.jpg`, { type: out.type || "image/jpeg" }));
      replaceBase(source, next, { group, label });
    } catch (e) {
      if (ctrl.signal.aborted || !mounted.current) return;
      setAiError({ message: aiMessage(e), retry: () => runAi(req, label, group) });
    } finally {
      lock?.release().catch(() => {});
      aiAbort.current = null;
      if (mounted.current) setAi(null);
    }
  };
  const removeLastAi = () => {
    const cur = docRef.current;
    const i = cur.edits.map((e) => e.group).lastIndexOf(CROP);
    // Only the last edit can be taken off on its own; if it's a crop, the AI panel shows none.
    if (cur.bases.length > 1 && i !== cur.edits.length - 1) apply({ ...cur, bases: cur.bases.slice(0, -1), edits: cur.edits.slice(0, -1) });
  };

  // ───────── save ─────────
  const save = async () => {
    setSaving(true);
    const p = photo;
    try {
      const full = exportCanvas(p);
      engine.setSource("export", p.id, pixels(full));
      full.width = full.height = 0; // the pixels now live in the engine: free the canvas right away
      const out = await engine.renderForSave("export", p.id, settings);
      let blob: Blob;
      if (out instanceof Blob) blob = out;
      else {
        const c = document.createElement("canvas");
        c.width = out.width;
        c.height = out.height;
        c.getContext("2d")!.putImageData(out, 0, 0);
        blob = await toBlob(c);
        c.width = c.height = 0;
      }
      setSavedDoc(docRef.current);
      const file = new File([blob], `${original.name}-visage.jpg`, { type: "image/jpeg" });
      setSaved((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), file };
      });
    } catch (e) {
      setToast(e instanceof StaleError ? "La foto cambió mientras se guardaba. Vuelve a tocar Guardar." : "No se pudo guardar la foto. Cierra otras apps y vuelve a intentarlo.");
    } finally {
      engine.release("export");
      if (mounted.current) setSaving(false);
    }
  };
  // The saved photo's URL is freed when the editor closes.
  const savedRef = useRef<Saved | null>(null);
  useLayoutEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useEffect(() => () => {
    if (savedRef.current) URL.revokeObjectURL(savedRef.current.url);
  }, []);

  /** "Before | after" side by side, for sharing the change. */
  const beforeAfter = async (after: File): Promise<File> => {
    const [a, b] = await Promise.all([loadImage(compareBase.file), loadImage(after)]);
    const H = Math.min(1800, b.naturalHeight);
    const wa = Math.round((a.naturalWidth * H) / a.naturalHeight), wb = Math.round((b.naturalWidth * H) / b.naturalHeight);
    const gap = Math.round(H * 0.01);
    const c = document.createElement("canvas");
    c.width = wa + gap + wb;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, H);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(a, 0, 0, wa, H);
    ctx.drawImage(b, wa + gap, 0, wb, H);
    const font = Math.round(H * 0.035);
    ctx.font = `600 ${font}px sans-serif`;
    ctx.textBaseline = "top";
    for (const [text, x] of [["Antes", font * 0.7], ["Después", wa + gap + font * 0.7]] as const) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      const w = ctx.measureText(text).width;
      ctx.fillRect(x - font * 0.4, font * 0.5, w + font * 0.8, font * 1.5);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x, font * 0.75);
    }
    const blob = await toBlob(c, "image/jpeg", 0.92);
    c.width = c.height = 0;
    return new File([blob], `${original.name}-antes-despues.jpg`, { type: "image/jpeg" });
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Test hook: /?debug lets automated checks set the sliders directly.
  useEffect(() => {
    if (location.search.includes("debug")) Object.assign(window, { __apply: (s: Settings) => setDoc((d) => ({ ...d, settings: s })), __faces: faces });
  }, [faces]);

  // Keep the selected tab visible in the scrolling bar.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector(`[data-cat="${category}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [category]);

  const cat = CATEGORIES.find((c) => c.id === category);
  const noFace = faces && !faces.length;
  const segPending = segLoading && needsSegmentation(settings);
  const openCategory = (id: string) => {
    setCategory(id);
    if (current?.segFailed && CATEGORIES.find((c) => c.id === id)?.needsSegmentation) setAnalyses((a) => ({ ...a, [photo.id]: { ...a[photo.id], segFailed: false } }));
  };
  const working = busy || ai;

  return (
    <main className="safe fixed inset-0 flex flex-col bg-black text-white short-landscape:grid short-landscape:grid-cols-[minmax(0,1fr)_380px] short-landscape:grid-rows-[auto_auto_minmax(0,1fr)]">
      <header className="flex items-center justify-between px-3 py-2 short-landscape:col-start-2 short-landscape:row-start-1">
        <button className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={close} aria-label="Cerrar">
          <Icon name="close" className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={histPos.index <= 0 || !!working} onClick={() => goTo(hist.current.index - 1)} aria-label="Deshacer">
            <Icon name="undo" className="h-5 w-5" />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={histPos.index >= histPos.length - 1 || !!working} onClick={() => goTo(hist.current.index + 1)} aria-label="Rehacer">
            <Icon name="redo" className="h-5 w-5" />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
            disabled={(bases.length === 1 && same(settings, DEFAULTS)) || !!working}
            onClick={() => apply({ bases: [original], edits: [], settings: DEFAULTS })}
            aria-label="Volver a la foto original"
          >
            <Icon name="reset" className="h-5 w-5" />
          </button>
        </div>
        <button className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-semibold disabled:opacity-60" onClick={save} disabled={saving || !current || segPending || !!working}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </header>

      <section className="relative min-h-0 flex-1 short-landscape:col-start-1 short-landscape:row-span-3 short-landscape:row-start-1">
        <Viewer canvas={canvas} onHoldChange={hold} split={split} onSplit={setSplitAt} />
        {!current && !ai && <Badge>Analizando el rostro…</Badge>}
        {current?.failed && !ai && (
          <button
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-xs text-white backdrop-blur"
            onClick={() => {
              setAnalyses((a) => {
                const n = { ...a };
                delete n[photo.id];
                return n;
              });
              setFaceRetry((n) => n + 1);
            }}
          >
            No se pudo analizar la cara · <span className="font-semibold text-fuchsia-300">Reintentar</span>
          </button>
        )}
        {ai && (
          <div className="absolute inset-0 grid place-items-center bg-black/45 backdrop-blur-[2px]">
            <div className="mx-6 flex flex-col items-center gap-3 rounded-3xl bg-black/75 px-6 py-5 text-center">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
              <div className="text-sm font-medium">{ai}</div>
              <div className="text-xs text-white/60">Generando con IA, suele tardar 10–30 s.</div>
              <div className="text-xs text-amber-200/80">No salgas de la app ni bloquees la pantalla hasta que termine.</div>
              <button className="mt-1 rounded-full bg-white/10 px-4 py-1.5 text-xs" onClick={() => aiAbort.current?.abort()}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {busy && <Badge>{busy}</Badge>}
        {segLoading && <Badge>Cargando cabello y fondo…</Badge>}
        {saving && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-black/75 px-6 py-5 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
              <div className="text-sm font-medium">Guardando a resolución completa…</div>
              <div className="text-xs text-white/55">Puede tardar unos segundos. No salgas de la app.</div>
            </div>
          </div>
        )}
        {holding && <Badge>Antes</Badge>}
        {split !== null && (
          <>
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px]">Antes</div>
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px]">Después</div>
          </>
        )}
        <div className="absolute bottom-3 right-3 flex gap-2">
          <button
            className={`grid h-11 w-11 place-items-center rounded-full backdrop-blur ${split !== null ? "bg-white text-black" : "bg-black/55"}`}
            aria-label={split !== null ? "Salir de la comparación" : "Comparar con pantalla dividida"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setSplitAt(split !== null ? null : 0.5)}
          >
            <Icon name="split" className="h-5 w-5" />
          </button>
          <button
            className="grid h-11 w-11 place-items-center rounded-full bg-black/55 backdrop-blur"
            aria-label="Mantén para ver el antes"
            onPointerDown={(e) => {
              e.stopPropagation();
              hold(true);
            }}
            onPointerUp={() => hold(false)}
            onPointerLeave={() => holding && hold(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Icon name="compare" className="h-5 w-5" />
          </button>
        </div>
        {toast && <div className="absolute inset-x-4 top-3 rounded-2xl bg-white/95 px-4 py-3 text-sm text-black shadow-xl">{toast}</div>}
      </section>

      {faceThumbs.length > 1 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto bg-neutral-950 px-4 pt-2 short-landscape:col-start-2 short-landscape:row-start-2">
          <span className="shrink-0 text-[11px] text-white/50">Editar:</span>
          {faceThumbs.map((t, i) => {
            const active = num(settings, "cara") === i;
            return (
              <button key={i} onClick={() => apply({ ...docRef.current, settings: { ...docRef.current.settings, cara: i } })} className={`h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ${active ? "ring-fuchsia-500" : "ring-white/10"}`} aria-label={`Cara ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t} alt="" className="h-full w-full object-cover" />
              </button>
            );
          })}
          <button onClick={() => apply({ ...docRef.current, settings: { ...docRef.current.settings, cara: -1 } })} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${num(settings, "cara") === -1 ? "bg-white text-black" : "bg-white/10 text-white/80"}`}>
            Todas
          </button>
        </div>
      )}

      <section className="panel shrink-0 bg-neutral-950 pb-1 pt-3 short-landscape:col-start-2 short-landscape:row-start-3 short-landscape:flex short-landscape:min-h-0 short-landscape:flex-col">
        <div className="h-[184px] overflow-y-auto short-landscape:h-auto short-landscape:min-h-0 short-landscape:flex-1">
          {category === "ia" ? (
            <AiPanel
              busy={!!working}
              edits={edits.filter((e) => e.group !== CROP)}
              canRemoveLast={edits.length > 0 && top?.group !== CROP}
              onRemoveLast={removeLastAi}
              onRun={runAi}
              error={aiError}
              onDismissError={() => setAiError(null)}
              needPassword={needPassword}
              onPassword={(pw) => {
                try {
                  localStorage.setItem("visage-clave", pw);
                } catch {}
                setNeedPassword(false);
                setAiError(null);
              }}
            />
          ) : category === "recortar" ? (
            <CropPanel value={cropNow} busy={!!working} onChange={applyCrop} />
          ) : category === "looks" ? (
            <div className="flex flex-col gap-3">
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pt-1">
                {[{ id: "", name: "Sin look", settings: {} }, ...LOOKS].map((l) => {
                  const active = activeLook === l.id;
                  return (
                    <button key={l.id || "none"} className="flex w-[84px] shrink-0 flex-col items-center gap-1.5" onClick={() => pickLook(l.id)} disabled={!!noFace && !!l.id}>
                      <div className={`h-[84px] w-[84px] overflow-hidden rounded-2xl bg-white/10 ring-2 transition ${active ? "ring-fuchsia-500" : "ring-transparent"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {lookThumbs[l.id] ? <img src={lookThumbs[l.id]} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-white/5" />}
                      </div>
                      <span className={`text-xs ${active ? "text-white" : "text-white/60"}`}>{l.name}</span>
                    </button>
                  );
                })}
              </div>
              {activeLook && (
                <div className="px-4">
                  <Slider
                    spec={{ kind: "slider", id: "lookIntensidad", label: "Intensidad del look", min: 0, max: 100 }}
                    settings={settings}
                    onChange={(p) => setDoc((d) => ({ ...d, settings: applyLook(d.settings, str(d.settings, "look"), Number(p.lookIntensidad)) }))}
                    onCommit={commit}
                  />
                </div>
              )}
            </div>
          ) : cat ? (
            <>
              {noFace && !["filtros", "ajustes", "fondo"].includes(cat.id) && <p className="px-4 pb-3 text-xs text-amber-200/80">Esta foto no tiene una cara detectada.</p>}
              <Controls controls={cat.controls} settings={settings} onChange={change} onCommit={commit} />
            </>
          ) : null}
        </div>

        <div className="relative mt-1 border-t border-white/10">
          <nav ref={nav} className="no-scrollbar flex gap-1 overflow-x-auto px-2 pt-2">
            {[{ id: "looks", label: "Looks", icon: "looks" }, { id: "ia", label: "IA", icon: "ai" }, ...CATEGORIES, { id: "recortar", label: "Recortar", icon: "crop" }].map((c) => (
              <button
                key={c.id}
                data-cat={c.id}
                onClick={() => openCategory(c.id)}
                className={`flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] ${category === c.id ? "text-white" : "text-white/45"}`}
              >
                <Icon name={c.icon} className="h-6 w-6" />
                {c.label}
              </button>
            ))}
          </nav>
          {/* Hint that the bar scrolls: more tabs past the edge. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-neutral-950 to-transparent" />
        </div>
      </section>

      {saved && <SaveSheet saved={saved} original={start.fromCamera ? original.file : null} onBeforeAfter={beforeAfter} onClose={() => setSaved(null)} onFile={onFile} />}
      {confirmClose && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/70 backdrop-blur-sm" onClick={() => setConfirmClose(false)}>
          <div className="safe-b w-full rounded-t-3xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h2 className="text-center text-lg font-semibold">¿Salir sin guardar?</h2>
            <p className="mt-1 text-center text-sm text-white/60">Perderás los cambios de esta foto.</p>
            <div className="mt-5 grid gap-2">
              <button className="rounded-2xl bg-white py-3.5 font-medium text-black" onClick={() => setConfirmClose(false)}>
                Seguir editando
              </button>
              <button
                className="rounded-2xl bg-white/10 py-3.5 font-medium text-red-300"
                onClick={async () => {
                  await clearSession();
                  onClose();
                }}
              >
                Salir y descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CropPanel({ value, busy, onChange }: { value: Transform; busy: boolean; onChange: (t: Transform) => void }) {
  // The zoom slider applies when released (each crop is a full-resolution image).
  const [zoom, setZoom] = useState<number | null>(null);
  const shownZoom = zoom ?? value.zoom;
  return (
    <div className="flex flex-col gap-4 px-4">
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onChange({ ...value, rot: (value.rot + 90) % 360 })} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 py-2.5 text-sm disabled:opacity-40">
          <Icon name="rotate" className="h-5 w-5" />
          Girar
        </button>
        <button disabled={busy} onClick={() => onChange({ ...value, flip: !value.flip })} className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-2.5 text-sm disabled:opacity-40 ${value.flip ? "bg-white text-black" : "bg-white/10"}`}>
          <Icon name="flip" className="h-5 w-5" />
          Voltear
        </button>
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {ASPECTS.map((a) => (
          <button key={a.id || "orig"} disabled={busy} onClick={() => onChange({ ...value, aspect: a.id })} className={`shrink-0 rounded-full px-4 py-2 text-sm disabled:opacity-40 ${value.aspect === a.id ? "bg-white text-black" : "bg-white/10 text-white/80"}`}>
            {a.name}
          </button>
        ))}
      </div>
      <Slider
        spec={{ kind: "slider", id: "zoom", label: "Acercar", min: 0, max: 100 }}
        settings={{ zoom: shownZoom }}
        onChange={(p) => setZoom(Number(p.zoom))}
        onCommit={() => {
          if (zoom !== null && zoom !== value.zoom) onChange({ ...value, zoom });
          setZoom(null);
        }}
      />
      {!isIdentity(value) && (
        <button disabled={busy} onClick={() => onChange(NO_TRANSFORM)} className="self-start rounded-full bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40">
          Quitar recorte
        </button>
      )}
    </div>
  );
}

function httpMessage(status: number) {
  if (status === 413) return "La foto es demasiado grande para enviarla a la IA.";
  if (status === 504) return "La IA tardó demasiado en responder. Vuelve a intentarlo.";
  if (status >= 500) return `El servidor de la IA falló (error ${status}). Vuelve a intentarlo en un momento.`;
  return `La IA no respondió bien (error ${status}).`;
}

/** Network failures on iOS come as English "Load failed" / "Failed to fetch": say what happened. */
function aiMessage(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /load failed|failed to fetch|networkerror|network connection/i.test(msg))
    return "Se cortó la conexión con la IA. Si saliste de la app, se bloqueó la pantalla o perdiste señal, la edición se interrumpió: vuelve a intentarlo.";
  return msg;
}

function drawFit(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement) {
  const { width: W, height: H } = ctx.canvas;
  const k = Math.min(W / img.width, H / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("No se pudo leer la foto"));
    r.readAsDataURL(blob);
  });
}

function AiPanel({
  busy,
  edits,
  canRemoveLast,
  onRemoveLast,
  onRun,
  error,
  onDismissError,
  needPassword,
  onPassword,
}: {
  busy: boolean;
  edits: AiEdit[];
  canRemoveLast: boolean;
  onRemoveLast: () => void;
  onRun: (req: { preset?: string; custom?: string }, label: string, group: string) => void;
  error: { message: string; retry: () => void } | null;
  onDismissError: () => void;
  needPassword: boolean;
  onPassword: (pw: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const [pw, setPw] = useState("");
  return (
    <div className="flex flex-col gap-3.5 px-4">
      {needPassword && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onPassword(pw);
          }}
        >
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña de la app" className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm outline-none" />
          <button className="rounded-xl bg-white px-4 text-sm font-medium text-black">Guardar</button>
        </form>
      )}
      {error && (
        <div className="rounded-2xl bg-red-500/15 px-3 py-2.5 text-[13px] text-red-100">
          <p>{error.message}</p>
          <div className="mt-2 flex gap-2">
            <button className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-40" onClick={error.retry} disabled={busy}>
              Reintentar
            </button>
            <button className="rounded-full bg-white/10 px-3 py-1 text-xs" onClick={onDismissError}>
              Cerrar
            </button>
          </div>
        </div>
      )}
      {edits.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-white/50">IA aplicada:</span>
          {edits.map((e, i) => (
            <span key={i} className="rounded-full bg-fuchsia-500/20 px-2.5 py-1 text-fuchsia-100">
              {e.label}
            </span>
          ))}
          {canRemoveLast && (
            <button className="rounded-full bg-white/10 px-2.5 py-1 text-white disabled:opacity-40" onClick={onRemoveLast} disabled={busy}>
              Quitar la última
            </button>
          )}
        </div>
      )}
      <div className="text-[11px] text-white/50">Envía la foto a Gemini (Google) · ~US$0,04–0,10 por edición</div>
      {AI_GROUPS.map((g) => (
        <div key={g.id}>
          <div className="mb-1.5 text-[13px] text-white/85">{g.label}</div>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {g.presets.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                // "Estilo" items are independent of each other; every other group is one choice.
                onClick={() => onRun({ preset: p.id }, `${g.label}: ${p.name}`, g.id === "estilo" ? p.id : g.id)}
                className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm text-white/90 active:bg-fuchsia-600 disabled:opacity-40"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <form
        className="flex gap-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!custom.trim()) return;
          (document.activeElement as HTMLElement | null)?.blur();
          onRun({ custom }, "Edición personalizada", "custom");
        }}
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          enterKeyHint="send"
          placeholder="Pide otra cosa, p. ej. ponle gafas de sol rojas"
          className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm outline-none placeholder:text-white/35"
        />
        <button disabled={busy || !custom.trim()} className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-medium disabled:opacity-40">
          Crear
        </button>
      </form>
    </div>
  );
}

/** Equal settings, treating a missing value as 0 / "". */
function same(a: Settings, b: Settings) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/65 px-4 py-1.5 text-xs text-white backdrop-blur">{children}</div>;
}

const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function SaveSheet({
  saved,
  original,
  onBeforeAfter,
  onClose,
  onFile,
}: {
  saved: Saved;
  /** The selfie as taken, when it came from the camera (iOS doesn't keep it in Photos). */
  original: Blob | null;
  onBeforeAfter: (after: File) => Promise<File>;
  onClose: () => void;
  onFile: (f: File | undefined) => void;
}) {
  const [making, setMaking] = useState(false);
  const share = async (file: File) => {
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else {
        // No share sheet (desktop browsers): download instead.
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch {
      // cancelled
    }
  };
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [saved.file] });
  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="safe-b max-h-full w-full overflow-y-auto rounded-t-3xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={saved.url} alt="Foto editada" className="mx-auto max-h-[40vh] rounded-2xl object-contain" />
        <p className="mt-3 text-center text-xs text-white/50">También puedes mantener pulsada la imagen y elegir «Guardar en Fotos».</p>
        <div className="mt-4 grid gap-2">
          {canShare && (
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 font-medium" onClick={() => share(saved.file)}>
              <Icon name="share" className="h-5 w-5" />
              Guardar en Fotos / Compartir
            </button>
          )}
          <a href={saved.url} download={saved.file.name} className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-3.5 font-medium">
            <Icon name="download" className="h-5 w-5" />
            {isIOS() ? "Guardar en Archivos" : "Descargar"}
          </a>
          <button
            className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 text-sm disabled:opacity-50"
            disabled={making}
            onClick={async () => {
              setMaking(true);
              try {
                await share(await onBeforeAfter(saved.file));
              } finally {
                setMaking(false);
              }
            }}
          >
            <Icon name="split" className="h-4 w-4" />
            {making ? "Preparando…" : "Guardar antes y después"}
          </button>
          {original && (
            <button className="rounded-2xl bg-white/10 py-3 text-sm" onClick={() => share(new File([original], "selfie-original.jpg", { type: original.type || "image/jpeg" }))}>
              Guardar también la foto original
            </button>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl py-3 text-sm text-white/70">
            Editar otra foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}
