"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blendIntoPhoto, cropCanvas, headCrop, loadImage } from "@/lib/ai-blend";
import { AI_GROUPS, AI_PRESETS } from "@/lib/ai-presets";
import { getEngine, StaleError } from "@/lib/engine/client";
import { needsSegmentation } from "@/lib/engine/render";
import { drawScaled, exportCanvas, loadPhoto, pixels, toBlob, type Photo } from "@/lib/photo";
import { clearSession, loadSession, persistStorage, saveImages, saveState, type AiEdit, type StoredSession } from "@/lib/session";
import { applyLook, CATEGORIES, DEFAULTS, LOOKS, num, str, type Settings } from "@/lib/settings";
import { detectFaces, preloadFaces, segment, type Face, type Segmentation } from "@/lib/vision";
import { Controls, Slider } from "./Controls";
import { Icon } from "./Icon";
import { Viewer } from "./Viewer";

type Saved = { url: string; file: File };
/** Everything that defines the edit: the photos (original first, then one per AI edit) and the sliders. */
type Doc = { bases: Photo[]; edits: AiEdit[]; settings: Settings };
type Start = Doc & { key: string };

/** While settings keep changing, the preview shows quick frames at this size… */
const DRAFT_EDGE = 720;
/** …and the full-quality preview once they've been still for this long. */
const SETTLE_MS = 250;

export function App() {
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    preloadFaces();
    persistStorage();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      const p = await loadPhoto(file);
      setStart({ key: p.id, bases: [p], edits: [], settings: DEFAULTS });
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
      setStart({ key: bases[0].id, bases, edits: s.edits.slice(0, bases.length - 1), settings: { ...DEFAULTS, ...s.settings } });
    } catch {
      setError("No se pudo recuperar la edición anterior.");
      await clearSession();
    } finally {
      setRestoring(false);
    }
  };

  if (!start) return <Home onFile={open} onRestore={restore} restoring={restoring} error={error} />;
  return <Editor key={start.key} start={start} onClose={() => setStart(null)} onFile={open} />;
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

function Home({ onFile, onRestore, restoring, error }: { onFile: (f: File | undefined) => void; onRestore: (s: StoredSession) => void; restoring: boolean; error: string }) {
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
            <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
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
  const docRef = useRef(doc);
  docRef.current = doc;
  const { bases, edits, settings } = doc;
  const original = bases[0];
  const photo = bases[bases.length - 1];
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const mounted = useRef(true);

  const [faces, setFaces] = useState<Face[] | null>(null);
  /** Which photo `faces` belongs to: renders wait until the current photo has been analysed. */
  const [analysed, setAnalysed] = useState("");
  const [seg, setSeg] = useState<Segmentation | null>(null);
  const [segState, setSegState] = useState<"none" | "loading" | "ready" | "error">("none");
  const [faceError, setFaceError] = useState(false);
  const [faceRetry, setFaceRetry] = useState(0);
  const [faceThumbs, setFaceThumbs] = useState<string[]>([]);
  /** Faces and masks per photo, so undoing an AI edit doesn't analyse the photo again. */
  const analyses = useRef(new Map<string, { faces: Face[]; seg: Segmentation | null }>());
  const [category, setCategory] = useState("looks");
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const [toast, setToast] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedDoc, setSavedDoc] = useState<Doc | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [ai, setAi] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{ message: string; retry: () => void } | null>(null);
  const aiAbort = useRef<AbortController | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  /** The last frame painted (shown again after "hold to compare"). */
  const shown = useRef<{ img: ImageData; draft: boolean } | null>(null);
  const draftCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      aiAbort.current?.abort();
    };
  }, []);

  // ───────── history (sliders, looks and AI edits all undo the same way) ─────────
  const hist = useRef<{ list: Doc[]; index: number }>({ list: [start], index: 0 });
  const [, setHistVersion] = useState(0);
  const sameDoc = (a: Doc, b: Doc) => a.bases === b.bases && same(a.settings, b.settings);
  const push = (d: Doc) => {
    const h = hist.current;
    if (sameDoc(d, h.list[h.index])) return;
    h.list = [...h.list.slice(0, h.index + 1), d].slice(-60);
    h.index = h.list.length - 1;
    setHistVersion((v) => v + 1);
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
    setHistVersion((v) => v + 1);
  };
  const { list: histList, index: histIndex } = hist.current;

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

    const cached = analyses.current.get(token);
    if (cached) {
      engine.setAnalysis(token, cached.faces, cached.seg);
      setFaceError(false);
      setAnalysed(token);
      setFaces(cached.faces);
      setSeg(cached.seg);
      setSegState(cached.seg ? "ready" : "none");
      return;
    }
    setFaces(null);
    setSeg(null);
    setSegState("none");
    setFaceError(false);
    // A download that never finishes must not leave "Analizando el rostro…" up forever.
    const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 25_000));
    Promise.race([detectFaces(photo.preview), timeout])
      .then((f) => {
        analyses.current.set(token, { faces: f, seg: null });
        engine.setAnalysis(token, f, null);
        if (cancelled) return;
        setAnalysed(token);
        setFaces(f);
        if (!f.length) setToast("No encontré ninguna cara. Puedes usar filtros, ajustes y fondo.");
      })
      .catch(() => {
        engine.setAnalysis(token, [], null);
        if (cancelled) return;
        // Not "no face": the detector itself failed (no connection the first time, iOS hiccup).
        // Filters and adjustments still work meanwhile; the badge offers to try again.
        setAnalysed(token);
        setFaces([]);
        setFaceError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, photo, faceRetry]);

  // Small pictures of each face, for choosing which one to edit when there are several.
  useEffect(() => {
    if (!faces || faces.length < 2 || analysed !== photo.id) {
      setFaceThumbs([]);
      return;
    }
    const src = photo.preview;
    setFaceThumbs(
      faces.map((f) => {
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
        for (const p of f) {
          x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        }
        const side = Math.max((x1 - x0) * src.width, (y1 - y0) * src.height) * 1.3;
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        c.getContext("2d")!.drawImage(src, ((x0 + x1) / 2) * src.width - side / 2, ((y0 + y1) / 2) * src.height - side / 2, side, side, 0, 0, 64, 64);
        return c.toDataURL("image/jpeg", 0.8);
      }),
    );
  }, [faces, analysed, photo]);

  // Hair and background need the segmentation model (about 16 MB), loaded only when used.
  const wantsSeg = needsSegmentation(settings) || !!CATEGORIES.find((c) => c.id === category)?.needsSegmentation;
  useEffect(() => {
    if (!wantsSeg || !faces || analysed !== photo.id || segState !== "none") return;
    const p = photo;
    const f = faces;
    setSegState("loading");
    segment(p.preview, f)
      .then((s) => {
        const entry = analyses.current.get(p.id);
        if (entry) entry.seg = s;
        engine.setAnalysis(p.id, f, s); // ignored by the engine if the photo changed meanwhile
        if (!mounted.current || photoRef.current.id !== p.id) return;
        setSeg(s);
        setSegState("ready");
      })
      .catch(() => {
        if (!mounted.current || photoRef.current.id !== p.id) return;
        setSegState("error");
        setToast("No se pudo cargar el modelo de cabello y fondo. Vuelve a abrir Cabello o Fondo para reintentar.");
      });
  }, [wantsSeg, faces, analysed, segState, photo, engine]);

  // ───────── preview ─────────
  const paint = useCallback((img: ImageData, draft: boolean) => {
    shown.current = { img, draft };
    const c = canvas.current;
    if (holdingRef.current || !c) return;
    const ctx = c.getContext("2d")!;
    if (img.width === c.width && img.height === c.height) {
      ctx.putImageData(img, 0, 0);
      return;
    }
    const t = (draftCanvas.current ??= document.createElement("canvas"));
    t.width = img.width;
    t.height = img.height;
    t.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(t, 0, 0, c.width, c.height);
  }, []);

  useEffect(() => {
    if (!faces || analysed !== photo.id) return;
    const token = photo.id;
    const show = (draft: boolean) => (img: ImageData | null) => {
      if (img && photoRef.current.id === token) paint(img, draft);
    };
    // Every change gets a quick small frame, so the photo follows the finger while dragging; the
    // full-quality frame comes once the settings stop changing for a moment.
    engine.preview("draft", token, settings).then(show(true));
    const t = window.setTimeout(() => engine.preview("preview", token, settings).then(show(false)), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [settings, faces, analysed, seg, photo, engine, paint]);

  const hold = useCallback(
    (h: boolean) => {
      holdingRef.current = h;
      setHolding(h);
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      if (h) drawFit(ctx, original.preview);
      else if (shown.current) paint(shown.current.img, shown.current.draft);
      else ctx.drawImage(photoRef.current.preview, 0, 0);
    },
    [original, paint],
  );

  // Look thumbnails: the face rendered with each look, cropped around the first face.
  useEffect(() => {
    setThumbs({});
    if (!faces?.length || analysed !== photo.id) return;
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
      const result: Record<string, string> = {};
      for (const look of [{ id: "", settings: {} }, ...LOOKS]) {
        const img = await engine.render("thumb", token, { ...DEFAULTS, ...look.settings, desenfoque: 0 });
        if (cancelled) return;
        tmp.getContext("2d")!.putImageData(img, 0, 0);
        out.getContext("2d")!.drawImage(tmp, cx - side / 2, cy - side / 2, side, side, 0, 0, 120, 120);
        result[look.id] = out.toDataURL("image/jpeg", 0.85);
        setThumbs({ ...result });
      }
      engine.release("thumb");
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [faces, analysed, photo, engine]);

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

  // ───────── AI ─────────
  const runAi = async (req: { preset?: string; custom?: string }, label: string, group: string) => {
    if (aiAbort.current) return;
    const cur = docRef.current;
    // A new choice in the same group (60 → 80 years, long → short hair) replaces the previous one
    // instead of being generated on top of it.
    const replace = group !== "custom" && cur.edits[cur.edits.length - 1]?.group === group;
    const source = cur.bases[cur.bases.length - (replace ? 2 : 1)];
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
      const facesOf = analyses.current.get(source.id)?.faces ?? [];
      const which = num(cur.settings, "cara") > 0 ? num(cur.settings, "cara") : 0;
      const face = scope === "face" ? (facesOf[which] ?? facesOf[0]) : undefined;
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
      const now = docRef.current;
      const at = now.bases.indexOf(source);
      if (at < 0 || !mounted.current) return; // undone while generating
      let nb = [...now.bases.slice(0, at + 1), next];
      let ne = [...now.edits.slice(0, at), { group, label }];
      // The original always stays; beyond that, the 7 most recent AI results.
      if (nb.length > 8) {
        nb = [nb[0], ...nb.slice(-7)];
        ne = ne.slice(-7);
      }
      apply({ bases: nb, edits: ne, settings: now.settings });
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
    if (cur.bases.length > 1) apply({ ...cur, bases: cur.bases.slice(0, -1), edits: cur.edits.slice(0, -1) });
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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Test hook: /?debug lets automated checks set the sliders directly.
  useEffect(() => {
    if (location.search.includes("debug")) Object.assign(window, { __apply: (s: Settings) => setDoc((d) => ({ ...d, settings: s })), __faces: faces });
  }, [faces]);

  const cat = CATEGORIES.find((c) => c.id === category);
  const noFace = faces && !faces.length;
  const segPending = segState === "loading" && needsSegmentation(settings);
  const openCategory = (id: string) => {
    setCategory(id);
    if (segState === "error" && CATEGORIES.find((c) => c.id === id)?.needsSegmentation) setSegState("none");
  };

  return (
    <main className="safe fixed inset-0 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between px-3 py-2">
        <button className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={close} aria-label="Cerrar">
          <Icon name="close" className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={histIndex <= 0} onClick={() => goTo(hist.current.index - 1)} aria-label="Deshacer">
            <Icon name="undo" className="h-5 w-5" />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={histIndex >= histList.length - 1} onClick={() => goTo(hist.current.index + 1)} aria-label="Rehacer">
            <Icon name="redo" className="h-5 w-5" />
          </button>
          <button
            className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
            disabled={bases.length === 1 && same(settings, DEFAULTS)}
            onClick={() => apply({ bases: [original], edits: [], settings: DEFAULTS })}
            aria-label="Volver a la foto original"
          >
            <Icon name="reset" className="h-5 w-5" />
          </button>
        </div>
        <button className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-semibold disabled:opacity-60" onClick={save} disabled={saving || !faces || analysed !== photo.id || segPending || !!ai}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </header>

      <section className="relative min-h-0 flex-1">
        <Viewer canvas={canvas} onHoldChange={hold} />
        {!faces && !ai && <Badge>Analizando el rostro…</Badge>}
        {faceError && !ai && (
          <button
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-xs text-white backdrop-blur"
            onClick={() => {
              analyses.current.delete(photo.id);
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
        {segState === "loading" && <Badge>Cargando cabello y fondo…</Badge>}
        {saving && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <div className="flex flex-col items-center gap-3 rounded-3xl bg-black/75 px-6 py-5 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-fuchsia-400" />
              <div className="text-sm font-medium">Guardando a resolución completa…</div>
              <div className="text-xs text-white/55">Puede tardar unos segundos. No salgas de la app.</div>
            </div>
          </div>
        )}
        {holding && <Badge>Original</Badge>}
        <button
          className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-black/55 backdrop-blur"
          aria-label="Mantén para ver el original"
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
        {toast && <div className="absolute inset-x-4 top-3 rounded-2xl bg-white/95 px-4 py-3 text-sm text-black shadow-xl">{toast}</div>}
      </section>

      {faceThumbs.length > 1 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto bg-neutral-950 px-4 pt-2">
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

      <section className="shrink-0 bg-neutral-950 pb-1 pt-3">
        <div className="h-[184px] overflow-y-auto">
          {category === "ia" ? (
            <AiPanel
              busy={!!ai}
              edits={edits}
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
          ) : category === "looks" ? (
            <div className="flex flex-col gap-3">
              <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pt-1">
                {[{ id: "", name: "Sin look", settings: {} }, ...LOOKS].map((l) => {
                  const active = activeLook === l.id;
                  return (
                    <button key={l.id || "none"} className="flex w-[84px] shrink-0 flex-col items-center gap-1.5" onClick={() => pickLook(l.id)} disabled={!!noFace && !!l.id}>
                      <div className={`h-[84px] w-[84px] overflow-hidden rounded-2xl bg-white/10 ring-2 transition ${active ? "ring-fuchsia-500" : "ring-transparent"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {thumbs[l.id] ? <img src={thumbs[l.id]} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-white/5" />}
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

        <nav className="no-scrollbar mt-1 flex gap-1 overflow-x-auto border-t border-white/10 px-2 pt-2">
          {[{ id: "looks", label: "Looks", icon: "looks" }, { id: "ia", label: "IA", icon: "ai" }, ...CATEGORIES].map((c) => (
            <button key={c.id} onClick={() => openCategory(c.id)} className={`flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] ${category === c.id ? "text-white" : "text-white/45"}`}>
              <Icon name={c.icon} className="h-6 w-6" />
              {c.label}
            </button>
          ))}
        </nav>
      </section>

      {saved && <SaveSheet saved={saved} onClose={() => setSaved(null)} onFile={onFile} />}
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
  onRemoveLast,
  onRun,
  error,
  onDismissError,
  needPassword,
  onPassword,
}: {
  busy: boolean;
  edits: AiEdit[];
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
          <button className="rounded-full bg-white/10 px-2.5 py-1 text-white disabled:opacity-40" onClick={onRemoveLast} disabled={busy}>
            Quitar la última
          </button>
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

function SaveSheet({ saved, onClose, onFile }: { saved: Saved; onClose: () => void; onFile: (f: File | undefined) => void }) {
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [saved.file] });
  const share = async () => {
    try {
      await navigator.share({ files: [saved.file] });
    } catch {
      // cancelled
    }
  };
  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="safe-b w-full rounded-t-3xl bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={saved.url} alt="Foto editada" className="mx-auto max-h-[45vh] rounded-2xl object-contain" />
        <p className="mt-3 text-center text-xs text-white/50">También puedes mantener pulsada la imagen y elegir «Guardar en Fotos».</p>
        <div className="mt-4 grid gap-2">
          {canShare && (
            <button className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 font-medium" onClick={share}>
              <Icon name="share" className="h-5 w-5" />
              Guardar en Fotos / Compartir
            </button>
          )}
          <a href={saved.url} download={saved.file.name} className="flex items-center justify-center gap-2 rounded-2xl bg-white/10 py-3.5 font-medium">
            <Icon name="download" className="h-5 w-5" />
            Descargar
          </a>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl py-3 text-sm text-white/70">
            Editar otra foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}
