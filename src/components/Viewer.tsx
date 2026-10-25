"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Shows the edited photo fitted to the available space. Pinch (or wheel) to zoom, drag to pan when
 * zoomed, double-tap to toggle 2.5×. Tapping and holding with one finger while not zoomed shows the
 * original, like FaceApp. In split mode (`split` is a position 0–1), dragging moves the divider
 * between the original and the edit instead.
 */
export function Viewer({
  canvas,
  onHoldChange,
  split,
  onSplit,
}: {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  onHoldChange: (holding: boolean) => void;
  split: number | null;
  onSplit: (position: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const [pinching, setPinching] = useState(false);
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; k: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const holding = useRef(false);
  const lastTap = useRef(0);
  const moved = useRef(false);
  const splitting = split !== null;

  const clampT = (k: number, x: number, y: number) => {
    const el = box.current;
    if (!el || k <= 1) return { k: 1, x: 0, y: 0 };
    const mx = (el.clientWidth * (k - 1)) / 2, my = (el.clientHeight * (k - 1)) / 2;
    return { k, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };

  const stopHold = () => {
    window.clearTimeout(holdTimer.current);
    if (holding.current) {
      holding.current = false;
      onHoldChange(false);
    }
  };

  /** Divider position under the finger, as a fraction of the photo's width. */
  const splitAt = (clientX: number) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    onSplit(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const cur = tRef.current;
      const k = Math.min(6, Math.max(1, cur.k * Math.exp(-e.deltaY * 0.0025)));
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
      setT(clampT(k, px - ((px - cur.x) * k) / cur.k, py - ((py - cur.y) * k) / cur.k));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const down = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // not capturable (e.g. the pointer is already gone): the gesture still works without it
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (splitting && pointers.current.size === 1) {
      splitAt(e.clientX);
      return;
    }
    if (pointers.current.size === 2) {
      stopHold();
      const [a, b] = [...pointers.current.values()];
      const r = box.current!.getBoundingClientRect();
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: tRef.current.k, cx: (a.x + b.x) / 2 - r.left - r.width / 2, cy: (a.y + b.y) / 2 - r.top - r.height / 2, x: tRef.current.x, y: tRef.current.y };
      setPinching(true);
    } else if (pointers.current.size === 1) {
      gesture.current = null;
      if (tRef.current.k <= 1) {
        holdTimer.current = window.setTimeout(() => {
          holding.current = true;
          onHoldChange(true);
        }, 160);
      }
    }
  };

  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2) moved.current = true;
    if (splitting && pointers.current.size === 1) {
      splitAt(e.clientX);
      return;
    }
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const g = gesture.current;
      const k = Math.min(6, Math.max(1, (g.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      const r = box.current!.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left - r.width / 2, cy = (a.y + b.y) / 2 - r.top - r.height / 2;
      setT(clampT(k, cx - ((g.cx - g.x) * k) / g.k, cy - ((g.cy - g.y) * k) / g.k));
    } else if (pointers.current.size === 1 && tRef.current.k > 1) {
      const c = tRef.current;
      setT(clampT(c.k, c.x + cur.x - prev.x, c.y + cur.y - prev.y));
    }
  };

  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) {
      gesture.current = null;
      setPinching(false);
    }
    if (splitting) return;
    const wasHolding = holding.current;
    stopHold();
    if (pointers.current.size === 0 && !moved.current && !wasHolding) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const el = box.current!;
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
        setT(tRef.current.k > 1 ? { k: 1, x: 0, y: 0 } : clampT(2.5, -px * 1.5, -py * 1.5));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  return (
    <div
      ref={box}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex h-full w-full items-center justify-center" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, transition: pinching ? "none" : "transform 60ms linear" }}>
        <canvas ref={canvas} className="max-h-full max-w-full object-contain" />
      </div>
      {t.k > 1 && (
        <button className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onClick={() => setT({ k: 1, x: 0, y: 0 })}>
          {t.k.toFixed(1)}× · ajustar
        </button>
      )}
    </div>
  );
}
