"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getEngine } from "@/lib/engine/client";
import { needsSegmentation } from "@/lib/engine/render";
import { drawScaled, exportCanvas, loadPhoto, pixels, toBlob, type Photo } from "@/lib/photo";
import { CATEGORIES, DEFAULTS, LOOKS, type Settings } from "@/lib/settings";
import { detectFaces, preloadFaces, segment, type Face, type Segmentation } from "@/lib/vision";
import { Controls } from "./Controls";
import { Icon } from "./Icon";
import { Viewer } from "./Viewer";

type Saved = { url: string; file: File };

export function App() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    preloadFaces();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      setPhoto(await loadPhoto(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!photo) return <Home onFile={open} error={error} />;
  return <Editor key={photo.preview.width + photo.name + photo.height} photo={photo} onClose={() => setPhoto(null)} onFile={open} />;
}

function Home({ onFile, error }: { onFile: (f: File | undefined) => void; error: string }) {
  return (
    <main className="safe flex min-h-dvh flex-col items-center justify-between bg-black px-6 py-10 text-white">
      <div className="mt-6 flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-20 w-20 rounded-[22px] shadow-[0_10px_40px_rgba(168,85,247,.45)]" />
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Rostro</h1>
        <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-white/60">Sonrisa, retoque, forma de la cara, maquillaje, color de ojos y cabello, fondo y filtros.</p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {error && <p className="rounded-2xl bg-red-500/15 px-4 py-3 text-sm text-red-200">{error}</p>}
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
          Todo se procesa en tu teléfono. Tus fotos no se suben a ningún sitio.
        </p>
      </div>
    </main>
  );
}

function Editor({ photo, onClose, onFile }: { photo: Photo; onClose: () => void; onFile: (f: File | undefined) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = getEngine();
  const [faces, setFaces] = useState<Face[] | null>(null);
  const [seg, setSeg] = useState<Segmentation | null>(null);
  const [segState, setSegState] = useState<"none" | "loading" | "ready" | "error">("none");
  const [history, setHistory] = useState<Settings[]>([DEFAULTS]);
  const [index, setIndex] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [category, setCategory] = useState("looks");
  const [holding, setHolding] = useState(false);
  const [toast, setToast] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const lastFrame = useRef<ImageData | null>(null);

  // Analyse the face once per photo.
  useEffect(() => {
    let cancelled = false;
    engine.setSource("preview", pixels(photo.preview));
    const c = canvas.current!;
    c.width = photo.preview.width;
    c.height = photo.preview.height;
    c.getContext("2d")!.drawImage(photo.preview, 0, 0);
    detectFaces(photo.preview)
      .then((f) => {
        if (cancelled) return;
        setFaces(f);
        engine.setAnalysis(f, null);
        if (!f.length) setToast("No encontré ninguna cara. Puedes usar filtros, ajustes y fondo.");
      })
      .catch(() => {
        if (cancelled) return;
        setFaces([]);
        setToast("No se pudo cargar el detector de caras. Revisa la conexión la primera vez.");
      });
    return () => {
      cancelled = true;
    };
  }, [engine, photo]);

  // Hair and background need the segmentation model (about 16 MB), loaded only when used.
  const wantsSeg = needsSegmentation(settings) || !!CATEGORIES.find((c) => c.id === category)?.needsSegmentation;
  useEffect(() => {
    if (!wantsSeg || !faces || segState !== "none") return;
    setSegState("loading");
    segment(photo.preview, faces)
      .then((s) => {
        setSeg(s);
        engine.setAnalysis(faces, s);
        setSegState("ready");
      })
      .catch(() => {
        setSegState("error");
        setToast("No se pudo cargar el modelo de cabello y fondo.");
      });
  }, [wantsSeg, faces, segState, photo, engine]);

  // Preview: re-render whenever the settings or the analysis change.
  useEffect(() => {
    if (!faces) return;
    let alive = true;
    engine.preview(settings).then((img) => {
      if (!alive || !img) return;
      lastFrame.current = img;
      if (!holdingRef.current) canvas.current?.getContext("2d")!.putImageData(img, 0, 0);
    });
    return () => {
      alive = false;
    };
  }, [settings, faces, seg, engine]);

  const holdingRef = useRef(false);
  const hold = useCallback(
    (h: boolean) => {
      holdingRef.current = h;
      setHolding(h);
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      if (h) ctx.drawImage(photo.preview, 0, 0);
      else if (lastFrame.current) ctx.putImageData(lastFrame.current, 0, 0);
    },
    [photo],
  );

  // Look thumbnails: the face rendered with each look, cropped around the first face.
  useEffect(() => {
    if (!faces?.length) return;
    let cancelled = false;
    (async () => {
      const small = drawScaled(photo.preview, photo.preview.width, photo.preview.height, 420);
      engine.setSource("thumb", pixels(small));
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
        const img = await engine.render("thumb", { ...DEFAULTS, ...look.settings, desenfoque: 0 });
        if (cancelled) return;
        tmp.getContext("2d")!.putImageData(img, 0, 0);
        const ctx = out.getContext("2d")!;
        ctx.drawImage(tmp, cx - side / 2, cy - side / 2, side, side, 0, 0, 120, 120);
        result[look.id] = out.toDataURL("image/jpeg", 0.85);
        setThumbs({ ...result });
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [faces, photo, engine]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const change = (patch: Settings) => setSettings((s) => ({ ...s, ...patch }));
  const push = (s: Settings) => {
    if (same(s, history[index])) return;
    const next = [...history.slice(0, index + 1), s].slice(-60);
    setHistory(next);
    setIndex(next.length - 1);
  };
  // Sliders change the settings live; the undo history only records where they were released.
  const commit = () => window.setTimeout(() => push(settingsRef.current));
  const apply = (s: Settings) => {
    setSettings(s);
    push(s);
  };
  const undo = () => {
    if (index <= 0) return;
    setIndex(index - 1);
    setSettings(history[index - 1]);
  };
  const redo = () => {
    if (index >= history.length - 1) return;
    setIndex(index + 1);
    setSettings(history[index + 1]);
  };

  // Test hook: /?debug lets automated checks set the sliders directly.
  useEffect(() => {
    if (location.search.includes("debug")) (window as unknown as { __apply: typeof setSettings }).__apply = setSettings;
  }, []);

  const activeLook =LOOKS.find((l) => same(settings, { ...DEFAULTS, ...l.settings }))?.id;

  const save = async () => {
    setSaving(true);
    try {
      const full = exportCanvas(photo);
      engine.setSource("export", pixels(full));
      const img = await engine.render("export", settings);
      full.getContext("2d")!.putImageData(img, 0, 0);
      const blob = await toBlob(full);
      full.width = full.height = 0;
      const file = new File([blob], `${photo.name}-rostro.jpg`, { type: "image/jpeg" });
      setSaved((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), file };
      });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const cat = CATEGORIES.find((c) => c.id === category);
  const noFace = faces && !faces.length;

  return (
    <main className="safe fixed inset-0 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between px-3 py-2">
        <button className="grid h-10 w-10 place-items-center rounded-full bg-white/10" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-1">
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={index <= 0} onClick={undo} aria-label="Deshacer">
            <Icon name="undo" className="h-5 w-5" />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={index >= history.length - 1} onClick={redo} aria-label="Rehacer">
            <Icon name="redo" className="h-5 w-5" />
          </button>
          <button className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" disabled={same(settings, DEFAULTS)} onClick={() => apply(DEFAULTS)} aria-label="Quitar todo">
            <Icon name="reset" className="h-5 w-5" />
          </button>
        </div>
        <button className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-sm font-semibold disabled:opacity-60" onClick={save} disabled={saving || !faces}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </header>

      <section className="relative min-h-0 flex-1">
        <Viewer canvas={canvas} onHoldChange={hold} />
        {!faces && <Badge>Analizando el rostro…</Badge>}
        {segState === "loading" && <Badge>Cargando cabello y fondo…</Badge>}
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

      <section className="shrink-0 bg-neutral-950 pb-1 pt-3">
        <div className="h-[184px] overflow-y-auto">
          {category === "looks" ? (
            <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pt-1">
              {[{ id: "", name: "Original", settings: {} }, ...LOOKS].map((l) => {
                const active = l.id ? activeLook === l.id : same(settings, DEFAULTS);
                return (
                  <button key={l.id || "original"} className="flex w-[84px] shrink-0 flex-col items-center gap-1.5" onClick={() => apply({ ...DEFAULTS, ...l.settings })} disabled={!!noFace && !!l.id}>
                    <div className={`h-[84px] w-[84px] overflow-hidden rounded-2xl bg-white/10 ring-2 transition ${active ? "ring-fuchsia-500" : "ring-transparent"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumbs[l.id] ? <img src={thumbs[l.id]} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full animate-pulse bg-white/5" />}
                    </div>
                    <span className={`text-xs ${active ? "text-white" : "text-white/60"}`}>{l.name}</span>
                  </button>
                );
              })}
            </div>
          ) : cat ? (
            <>
              {noFace && !["filtros", "ajustes", "fondo"].includes(cat.id) && <p className="px-4 pb-3 text-xs text-amber-200/80">Esta foto no tiene una cara detectada.</p>}
              <Controls controls={cat.controls} settings={settings} onChange={change} onCommit={commit} />
            </>
          ) : null}
        </div>

        <nav className="no-scrollbar mt-1 flex gap-1 overflow-x-auto border-t border-white/10 px-2 pt-2">
          {[{ id: "looks", label: "Looks", icon: "looks" }, ...CATEGORIES].map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)} className={`flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] ${category === c.id ? "text-white" : "text-white/45"}`}>
              <Icon name={c.icon} className="h-6 w-6" />
              {c.label}
            </button>
          ))}
        </nav>
      </section>

      {saved && <SaveSheet saved={saved} onClose={() => setSaved(null)} onFile={onFile} />}
    </main>
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
