// Liquify-style reshaping. Each operation pulls or scales the picture around a point with a smooth
// falloff; all operations are summed into one displacement field that is applied once (backward
// mapping: every output pixel looks up where its colour comes from).
import type { P } from "./raster";

export type WarpOp =
  | { kind: "move"; c: P; r: number; v: P }
  | { kind: "scale"; c: P; r: number; s: number }
  /** Scales only along the unit axis `u` (e.g. the face's vertical axis, which follows a tilted head). */
  | { kind: "stretch"; c: P; r: number; s: number; u: P };

export type Field = { x0: number; y0: number; w: number; h: number; dx: Float32Array; dy: Float32Array };

const falloff = (d2: number, r2: number) => {
  const t = 1 - d2 / r2;
  return t * t;
};

function addOp(op: WarpOp, x: number, y: number, out: { x: number; y: number }) {
  const ex = x - op.c.x, ey = y - op.c.y;
  const d2 = ex * ex + ey * ey;
  const r2 = op.r * op.r;
  if (d2 >= r2) return;
  const w = falloff(d2, r2);
  if (op.kind === "move") {
    out.x -= op.v.x * w;
    out.y -= op.v.y * w;
  } else if (op.kind === "scale") {
    out.x -= ex * op.s * w;
    out.y -= ey * op.s * w;
  } else {
    const along = (ex * op.u.x + ey * op.u.y) * op.s * w;
    out.x -= op.u.x * along;
    out.y -= op.u.y * along;
  }
}

export function displacementAt(ops: WarpOp[], x: number, y: number) {
  const d = { x: 0, y: 0 };
  for (const op of ops) addOp(op, x, y, d);
  return d;
}

/**
 * Where a point of the original ends up after the warp: solves p + D(p) = q by damped fixed-point
 * iteration (undamped, strong overlapping pulls can oscillate instead of converging).
 */
export function forward(ops: WarpOp[], q: P): P {
  let p = { x: q.x, y: q.y };
  for (let i = 0; i < 14; i++) {
    const d = displacementAt(ops, p.x, p.y);
    p = { x: p.x + 0.7 * (q.x - d.x - p.x), y: p.y + 0.7 * (q.y - d.y - p.y) };
  }
  return p;
}

export function buildField(ops: WarpOp[], W: number, H: number): Field | null {
  if (!ops.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const op of ops) {
    x0 = Math.min(x0, op.c.x - op.r);
    y0 = Math.min(y0, op.c.y - op.r);
    x1 = Math.max(x1, op.c.x + op.r);
    y1 = Math.max(y1, op.c.y + op.r);
  }
  const fx0 = Math.max(0, Math.floor(x0));
  const fy0 = Math.max(0, Math.floor(y0));
  const w = Math.max(0, Math.min(W, Math.ceil(x1)) - fx0);
  const h = Math.max(0, Math.min(H, Math.ceil(y1)) - fy0);
  if (!w || !h) return null;
  const dx = new Float32Array(w * h);
  const dy = new Float32Array(w * h);
  for (const op of ops) {
    const ox0 = Math.max(fx0, Math.floor(op.c.x - op.r));
    const ox1 = Math.min(fx0 + w, Math.ceil(op.c.x + op.r));
    const oy0 = Math.max(fy0, Math.floor(op.c.y - op.r));
    const oy1 = Math.min(fy0 + h, Math.ceil(op.c.y + op.r));
    const r2 = op.r * op.r;
    for (let y = oy0; y < oy1; y++) {
      const ey = y + 0.5 - op.c.y;
      for (let x = ox0; x < ox1; x++) {
        const ex = x + 0.5 - op.c.x;
        const d2 = ex * ex + ey * ey;
        if (d2 >= r2) continue;
        const f = falloff(d2, r2);
        const k = (y - fy0) * w + (x - fx0);
        if (op.kind === "move") {
          dx[k] -= op.v.x * f;
          dy[k] -= op.v.y * f;
        } else if (op.kind === "scale") {
          dx[k] -= ex * op.s * f;
          dy[k] -= ey * op.s * f;
        } else {
          const along = (ex * op.u.x + ey * op.u.y) * op.s * f;
          dx[k] -= op.u.x * along;
          dy[k] -= op.u.y * along;
        }
      }
    }
  }
  return { x0: fx0, y0: fy0, w, h, dx, dy };
}

/** Smallest Jacobian determinant of the map p → p + s·D(p): at or below 0 the picture folds over. */
function minDeterminant(f: Field, s: number) {
  let min = Infinity;
  const { w, h, dx, dy } = f;
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const k = y * w + x;
      const a = 1 + s * (dx[k + 1] - dx[k]), b = s * (dx[k + w] - dx[k]);
      const c = s * (dy[k + 1] - dy[k]), d = 1 + s * (dy[k + w] - dy[k]);
      const det = a * d - b * c;
      if (det < min) min = det;
    }
  return min;
}

const scaleOp = (op: WarpOp, k: number): WarpOp => (op.kind === "move" ? { ...op, v: { x: op.v.x * k, y: op.v.y * k } } : { ...op, s: op.s * k });

/**
 * Builds the field, and if the summed pulls are strong enough to fold the picture (several shape
 * sliders at extremes on the same area), tones every pull down just enough to keep it a clean,
 * one-to-one warp. Returns the ops actually used, so landmarks are moved consistently.
 */
export function buildSafeField(ops: WarpOp[], W: number, H: number): { field: Field | null; ops: WarpOp[] } {
  const field = buildField(ops, W, H);
  // Below ~0.35 the warp is not folded yet but stretches a thin strip into visible streaks.
  const LIMIT = 0.35;
  if (!field || minDeterminant(field, 1) >= LIMIT) return { field, ops };
  let lo = 0, hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    if (minDeterminant(field, mid) >= LIMIT) lo = mid;
    else hi = mid;
  }
  for (let k = 0; k < field.dx.length; k++) {
    field.dx[k] *= lo;
    field.dy[k] *= lo;
  }
  return { field, ops: ops.map((op) => scaleOp(op, lo)) };
}

/** Applies the field to an RGBA image (bilinear sampling); pixels outside the field are copied. */
export function applyField(src: Uint8ClampedArray, W: number, H: number, f: Field): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  for (let y = 0; y < f.h; y++) {
    const gy = f.y0 + y;
    for (let x = 0; x < f.w; x++) {
      const k = y * f.w + x;
      const ddx = f.dx[k], ddy = f.dy[k];
      if (ddx === 0 && ddy === 0) continue;
      const gx = f.x0 + x;
      let sx = gx + ddx, sy = gy + ddy;
      sx = sx < 0 ? 0 : sx > W - 1 ? W - 1 : sx;
      sy = sy < 0 ? 0 : sy > H - 1 ? H - 1 : sy;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const ix1 = ix + 1 < W ? ix + 1 : ix, iy1 = iy + 1 < H ? iy + 1 : iy;
      const tx = sx - ix, ty = sy - iy;
      const i00 = (iy * W + ix) * 4, i10 = (iy * W + ix1) * 4, i01 = (iy1 * W + ix) * 4, i11 = (iy1 * W + ix1) * 4;
      const o = (gy * W + gx) * 4;
      for (let c = 0; c < 3; c++) {
        const a = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * tx;
        const b = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * tx;
        out[o + c] = a + (b - a) * ty;
      }
    }
  }
  return out;
}

/** Source position (in the unwarped image) of an output pixel. */
export function sourceOf(f: Field | null, x: number, y: number): P {
  if (!f) return { x, y };
  const lx = x - f.x0, ly = y - f.y0;
  if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) return { x, y };
  const k = ly * f.w + lx;
  return { x: x + f.dx[k], y: y + f.dy[k] };
}
