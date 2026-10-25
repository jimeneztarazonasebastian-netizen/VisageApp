// Pure-JS rasterising and blurring, so the engine runs the same in a worker as on the main thread.

export type P = { x: number; y: number };
/** A soft mask covering only a rectangle of the image (values 0–1). */
export type Region = { x0: number; y0: number; w: number; h: number; a: Float32Array };

export function bounds(pts: P[], pad: number, W: number, H: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const bx0 = Math.max(0, Math.floor(x0 - pad));
  const by0 = Math.max(0, Math.floor(y0 - pad));
  const bx1 = Math.min(W, Math.ceil(x1 + pad));
  const by1 = Math.min(H, Math.ceil(y1 + pad));
  return { x0: bx0, y0: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) };
}

export function emptyRegion(b: { x0: number; y0: number; w: number; h: number }): Region {
  return { ...b, a: new Float32Array(b.w * b.h) };
}

/** Closed Catmull-Rom curve through the points: landmark outlines become smooth instead of faceted. */
export function smoothClosed(pts: P[], steps = 4): P[] {
  const out: P[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
  }
  return out;
}

export function smoothOpen(pts: P[], steps = 4): P[] {
  const out: P[] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let s = 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
  }
  out.push(pts[n - 1]);
  return out;
}

function catmull(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * Fills a polygon into the region with `value` (use a negative value to cut a hole). Each row is
 * sampled four times, which gives anti-aliased edges vertically; horizontal span ends get partial
 * coverage.
 */
export function fillPolygon(r: Region, poly: P[], value = 1) {
  const SUB = 4;
  const n = poly.length;
  const xs: number[] = [];
  const acc = new Float32Array(r.w);
  for (let y = 0; y < r.h; y++) {
    acc.fill(0);
    let any = false;
    for (let s = 0; s < SUB; s++) {
      const sy = r.y0 + y + (s + 0.5) / SUB;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > sy) !== (b.y > sy)) xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x) - r.x0);
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, xs[k]), xb = Math.min(r.w, xs[k + 1]);
        if (xb <= xa) continue;
        any = true;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) {
          if (ia < r.w) acc[ia] += xb - xa;
          continue;
        }
        acc[ia] += ia + 1 - xa;
        for (let x = ia + 1; x < ib; x++) acc[x] += 1;
        if (ib < r.w) acc[ib] += xb - ib;
      }
    }
    if (!any) continue;
    const row = y * r.w;
    for (let x = 0; x < r.w; x++) {
      if (!acc[x]) continue;
      const v = r.a[row + x] + (acc[x] / SUB) * value;
      r.a[row + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

/** Anti-aliased stroke along a polyline; `width(t)` gives the thickness at t∈[0,1] along it. */
export function strokePolyline(r: Region, line: P[], width: (t: number) => number, value = 1) {
  const n = line.length;
  if (n < 2) return;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const total = cum[n - 1] || 1;
  for (let i = 0; i < n - 1; i++) {
    const a = line[i], b = line[i + 1];
    const wa = width(cum[i] / total) / 2, wb = width(cum[i + 1] / total) / 2;
    const pad = Math.max(wa, wb) + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad - r.x0));
    const x1 = Math.min(r.w - 1, Math.ceil(Math.max(a.x, b.x) + pad - r.x0));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad - r.y0));
    const y1 = Math.min(r.h - 1, Math.ceil(Math.max(a.y, b.y) + pad - r.y0));
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y++) {
      const py = y + r.y0 + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + r.x0 + 0.5;
        let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
        const half = wa + (wb - wa) * t;
        const cov = Math.min(1, Math.max(0, half + 0.5 - d));
        if (cov <= 0) continue;
        const k = y * r.w + x;
        const v = Math.max(r.a[k], cov * value);
        r.a[k] = v > 1 ? 1 : v;
      }
    }
  }
}

/** Soft ellipse (1 inside, fading to 0 at the edge with a smooth falloff). */
export function fillEllipse(r: Region, c: P, rx: number, ry: number, angle: number, value = 1, hardness = 0) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let y = 0; y < r.h; y++) {
    const py = y + r.y0 + 0.5 - c.y;
    for (let x = 0; x < r.w; x++) {
      const px = x + r.x0 + 0.5 - c.x;
      const u = (px * cos + py * sin) / rx;
      const v = (-px * sin + py * cos) / ry;
      const d = Math.sqrt(u * u + v * v);
      if (d >= 1) continue;
      const t = d <= hardness ? 1 : 1 - (d - hardness) / (1 - hardness);
      const s = t * t * (3 - 2 * t);
      const k = y * r.w + x;
      r.a[k] = Math.min(1, Math.max(r.a[k], s * value));
    }
  }
}

/** Box sizes whose three passes approximate a Gaussian of the given sigma. */
function boxes(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}

/** Gaussian blur (three box passes) of a single-channel float image, in place. */
export function gaussian(a: Float32Array, w: number, h: number, sigma: number) {
  if (sigma < 0.3 || !w || !h) return a;
  const tmp = new Float32Array(a.length);
  for (const r of boxes(sigma)) {
    const rr = Math.round(r);
    if (rr < 1) continue;
    boxH(a, tmp, w, h, rr);
    boxV(tmp, a, w, h, rr);
  }
  return a;
}

function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    let val = (r + 1) * first;
    for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      val += src[row + Math.min(x + r, w - 1)] - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
      dst[row + x] = val * iarr;
    }
  }
}

/**
 * Vertical pass, walked row by row with one running sum per column: the same result as going down
 * each column, but memory is read in order, which is several times faster on large images.
 */
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  const acc = new Float32Array(w);
  for (let x = 0; x < w; x++) acc[x] = (r + 1) * src[x];
  for (let j = 0; j < r; j++) {
    const row = Math.min(j, h - 1) * w;
    for (let x = 0; x < w; x++) acc[x] += src[row + x];
  }
  for (let y = 0; y < h; y++) {
    const add = Math.min(y + r, h - 1) * w;
    const sub = y - r - 1 >= 0 ? (y - r - 1) * w : 0; // row 0 doubles as the clamped edge
    const out = y * w;
    for (let x = 0; x < w; x++) {
      acc[x] += src[add + x] - src[sub + x];
      dst[out + x] = acc[x] * iarr;
    }
  }
}

/** Mean filter with radius r (one box pass each way), returning a new array. */
export function boxMean(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(a.length);
  const out = new Float32Array(a.length);
  boxH(a, tmp, w, h, r);
  boxV(tmp, out, w, h, r);
  return out;
}

export function blurRegion(r: Region, sigma: number) {
  gaussian(r.a, r.w, r.h, sigma);
  return r;
}
