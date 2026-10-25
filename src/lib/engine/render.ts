// The whole edit, from the untouched photo to the final pixels. It only depends on the photo, the
// face landmarks, the (optional) segmentation and the settings, and every size is relative to the face
// or the picture, so the preview and the full-resolution export look the same.
import * as L from "../landmarks";
import { num, str, type Settings } from "../settings";
import type { Face, Mask, Segmentation } from "../vision";
import { clamp01, hexToRgb, hslToRgb, luma, rgbToHsl, smoothstep, softLight } from "./color";
import {
  blurRegion,
  bounds,
  boxMean,
  emptyRegion,
  fillEllipse,
  fillPolygon,
  gaussian,
  smoothClosed,
  smoothOpen,
  strokePolyline,
  type P,
  type Region,
} from "./raster";
import { applyField, buildSafeField, forward, sourceOf, type Field, type WarpOp } from "./warp";

export type RenderInput = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  faces: Face[];
  seg: Segmentation | null;
  settings: Settings;
};

export type Geo = {
  p: P[];
  ex: P; // across the face, image-left → image-right
  ey: P; // down the face, forehead → chin
  faceW: number;
  faceH: number;
  eyeW: number;
  mouthW: number;
};

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const norm = (a: P): P => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const centroid = (pts: P[]): P => mul(pts.reduce(add, { x: 0, y: 0 }), 1 / pts.length);
const pick = (p: P[], idx: number[]) => idx.map((i) => p[i]);
/** Grows (k > 1) or shrinks a polygon around its centre. */
const scalePoly = (pts: P[], k: number) => {
  const c = centroid(pts);
  return pts.map((q) => add(c, mul(sub(q, c), k)));
};

function geometry(p: P[]): Geo {
  const eyeL = centroid(pick(p, L.EYE_L));
  const eyeR = centroid(pick(p, L.EYE_R));
  const ex = norm(sub(eyeR, eyeL));
  let ey: P = { x: -ex.y, y: ex.x };
  if (dot(sub(p[L.CHIN], p[L.FOREHEAD]), ey) < 0) ey = mul(ey, -1);
  return {
    p,
    ex,
    ey,
    faceW: dist(p[L.FACE_SIDE_L], p[L.FACE_SIDE_R]),
    faceH: dist(p[L.FOREHEAD], p[L.CHIN]),
    eyeW: (dist(p[L.EYE_OUTER_L], p[L.EYE_INNER_L]) + dist(p[L.EYE_OUTER_R], p[L.EYE_INNER_R])) / 2,
    mouthW: dist(p[L.MOUTH_CORNER_L], p[L.MOUTH_CORNER_R]),
  };
}

const v = (s: Settings, id: string) => num(s, id) / 100;

// ───────────────────────────── shape ─────────────────────────────

function warpOps(g: Geo, s: Settings): WarpOp[] {
  const ops: WarpOp[] = [];
  const { p, ex, ey, faceW, faceH, eyeW, mouthW } = g;
  const up = mul(ey, -1);
  const midFace = mid(p[L.FACE_SIDE_L], p[L.FACE_SIDE_R]);
  const sideOf = (q: P) => (dot(sub(q, midFace), ex) < 0 ? -1 : 1);

  const smile = v(s, "sonrisa");
  if (smile) {
    const mc = mid(p[L.MOUTH_CORNER_L], p[L.MOUTH_CORNER_R]);
    for (const i of [L.MOUTH_CORNER_L, L.MOUTH_CORNER_R]) {
      const out = norm(sub(p[i], mc));
      ops.push({ kind: "move", c: p[i], r: mouthW * 0.6, v: add(mul(up, 0.2 * mouthW * smile), mul(out, 0.07 * mouthW * smile)) });
    }
    for (const i of [L.SMILE_CHEEK_L, L.SMILE_CHEEK_R]) ops.push({ kind: "move", c: p[i], r: mouthW * 0.55, v: mul(up, 0.07 * mouthW * smile) });
    ops.push({ kind: "move", c: p[L.UPPER_LIP], r: mouthW * 0.32, v: mul(up, 0.025 * mouthW * smile) });
    if (smile > 0) for (const i of [L.LOWER_LID_L, L.LOWER_LID_R]) ops.push({ kind: "move", c: p[i], r: eyeW * 0.55, v: mul(up, 0.06 * eyeW * smile) });
  }

  const slim = v(s, "rostro");
  if (slim) {
    const weights = [0.65, 0.9, 1, 1, 0.85, 0.6];
    [...L.JAW_L.map((i, k) => [i, weights[k]]), ...L.JAW_R.map((i, k) => [i, weights[k]])].forEach(([i, w]) =>
      ops.push({ kind: "move", c: p[i], r: faceW * 0.2, v: mul(ex, -sideOf(p[i]) * 0.05 * faceW * slim * w) }),
    );
    for (const i of [L.FACE_SIDE_L, L.FACE_SIDE_R]) ops.push({ kind: "move", c: p[i], r: faceW * 0.18, v: mul(ex, -sideOf(p[i]) * 0.02 * faceW * slim) });
  }

  const cheek = v(s, "pomulos");
  if (cheek) {
    for (const i of [L.CHEEKBONE_L, L.CHEEKBONE_R])
      ops.push({ kind: "move", c: p[i], r: faceW * 0.17, v: add(mul(ex, sideOf(p[i]) * 0.03 * faceW * cheek), mul(up, 0.015 * faceW * cheek)) });
  }

  const chin = v(s, "menton");
  if (chin) {
    ops.push({ kind: "move", c: p[L.CHIN], r: faceW * 0.32, v: mul(ey, 0.05 * faceH * chin) });
  }

  const forehead = v(s, "frente");
  if (forehead) {
    ops.push({ kind: "move", c: p[L.FOREHEAD], r: faceW * 0.42, v: mul(ey, 0.045 * faceH * forehead) });
  }

  const eyes = v(s, "ojos");
  if (eyes) {
    const centres = p.length > L.IRIS_R ? [p[L.IRIS_L], p[L.IRIS_R]] : [centroid(pick(p, L.EYE_L)), centroid(pick(p, L.EYE_R))];
    for (const c of centres) ops.push({ kind: "scale", c, r: eyeW * 1.15, s: 0.17 * eyes });
  }

  const nose = v(s, "nariz");
  if (nose) {
    const wl = p[L.NOSE_WING_L], wr = p[L.NOSE_WING_R];
    const nw = dist(wl, wr);
    const nc = mid(wl, wr);
    for (const q of [wl, wr]) ops.push({ kind: "move", c: q, r: nw * 0.6, v: mul(norm(sub(nc, q)), 0.16 * nw * nose) });
    ops.push({ kind: "scale", c: p[L.NOSE_TIP], r: nw * 0.7, s: -0.08 * nose });
  }

  const lips = v(s, "labios");
  if (lips) {
    const c = mid(p[L.LIP_TOP_INNER], p[L.LIP_BOTTOM_INNER]);
    // Stretch only along the face's vertical axis, so the mouth gets fuller without getting wider
    // (also with the head tilted).
    ops.push({ kind: "stretch", c, r: mouthW * 0.7, s: 0.2 * lips, u: ey });
  }

  // Brow lift from "Subir cejas" and "Sorpresa" together, as one set of pulls: neighbouring brow
  // points overlap (about 1.5× where they meet), so each pull is scaled down to that, and the total
  // is capped so the two sliders at +100 don't streak the forehead.
  const browLift = Math.max(-0.12, Math.min(0.17, 0.09 * v(s, "cejas") + 0.16 * v(s, "sorpresa"))) / 1.5;
  if (browLift) {
    for (const i of [...L.BROW_L.slice(0, 5), ...L.BROW_R.slice(0, 5)]) ops.push({ kind: "move", c: p[i], r: eyeW * 0.55, v: mul(up, browLift * eyeW) });
  }

  // Weight: cheeks and jaw puff out (or hollow in) the way the soft tissue does, more at the bottom.
  const weight = v(s, "peso");
  if (weight) {
    const weights = [0.8, 1, 1, 0.9, 0.7, 0.5];
    [...L.JAW_L.map((i, k) => [i, weights[k]]), ...L.JAW_R.map((i, k) => [i, weights[k]])].forEach(([i, w]) =>
      ops.push({ kind: "move", c: p[i], r: faceW * 0.24, v: add(mul(ex, sideOf(p[i]) * 0.055 * faceW * weight * w), mul(ey, 0.012 * faceW * weight * w)) }),
    );
    for (const i of [L.SMILE_CHEEK_L, L.SMILE_CHEEK_R]) ops.push({ kind: "scale", c: p[i], r: faceW * 0.2, s: 0.07 * weight });
    ops.push({ kind: "move", c: p[L.CHIN], r: faceW * 0.3, v: mul(ey, 0.025 * faceH * weight) });
  }

  // Surprise: brows up, eyes wider open.
  // Surprise: brows up (in browLift above) and eyes wider open.
  const surprise = v(s, "sorpresa");
  const openEyes = v(s, "abrirOjos") + surprise * 0.8;
  if (openEyes) {
    const centres = p.length > L.IRIS_R ? [p[L.IRIS_L], p[L.IRIS_R]] : [centroid(pick(p, L.EYE_L)), centroid(pick(p, L.EYE_R))];
    for (const c of centres) ops.push({ kind: "stretch", c, r: eyeW * 0.85, s: 0.22 * Math.max(-1, Math.min(1.2, openEyes)), u: ey });
  }

  // Frown: inner brow ends down and towards each other, outer ends slightly up.
  const frown = v(s, "enfado");
  if (frown) {
    const browC = mid(p[L.BROW_MID_L], p[L.BROW_MID_R]);
    for (const [inner, outer] of [
      [107, 70],
      [336, 300],
    ]) {
      ops.push({ kind: "move", c: p[inner], r: eyeW * 0.5, v: add(mul(ey, 0.12 * eyeW * frown), mul(norm(sub(browC, p[inner])), 0.08 * eyeW * frown)) });
      ops.push({ kind: "move", c: p[outer], r: eyeW * 0.4, v: mul(up, 0.04 * eyeW * frown) });
    }
    for (const i of [L.MOUTH_CORNER_L, L.MOUTH_CORNER_R]) ops.push({ kind: "move", c: p[i], r: mouthW * 0.5, v: mul(ey, 0.06 * mouthW * frown) });
  }
  return ops;
}

// ───────────────────────────── helpers ─────────────────────────────

type Img = { d: Uint8ClampedArray; W: number; H: number };
type Planes = { Y: Float32Array; Cb: Float32Array; Cr: Float32Array };

function extract(img: Img, b: { x0: number; y0: number; w: number; h: number }): Planes {
  const n = b.w * b.h;
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const i = ((b.y0 + y) * img.W + b.x0 + x) * 4;
      const r = img.d[i], g = img.d[i + 1], bl = img.d[i + 2];
      const k = y * b.w + x;
      Y[k] = 0.299 * r + 0.587 * g + 0.114 * bl;
      Cb[k] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * bl;
      Cr[k] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * bl;
    }
  return { Y, Cb, Cr };
}

function commit(img: Img, b: { x0: number; y0: number; w: number; h: number }, pl: Planes, m?: Region) {
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const k = y * b.w + x;
      if (m && m.a[k] <= 0.002) continue;
      const i = ((b.y0 + y) * img.W + b.x0 + x) * 4;
      const Y = pl.Y[k], cb = pl.Cb[k] - 128, cr = pl.Cr[k] - 128;
      img.d[i] = Y + 1.402 * cr;
      img.d[i + 1] = Y - 0.344136 * cb - 0.714136 * cr;
      img.d[i + 2] = Y + 1.772 * cb;
    }
}

const sampleMask = (m: Mask, W: number, H: number, x: number, y: number) => {
  const fx = Math.min(m.width - 1, Math.max(0, ((x + 0.5) / W) * m.width - 0.5));
  const fy = Math.min(m.height - 1, Math.max(0, ((y + 0.5) / H) * m.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(m.width - 1, x0 + 1), y1 = Math.min(m.height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = m.data[y0 * m.width + x0] + (m.data[y0 * m.width + x1] - m.data[y0 * m.width + x0]) * tx;
  const b = m.data[y1 * m.width + x0] + (m.data[y1 * m.width + x1] - m.data[y1 * m.width + x0]) * tx;
  return a + (b - a) * ty;
};

/** A segmentation mask at render resolution, following the reshaping. */
function maskAt(m: Mask, img: Img, field: Field | null, x: number, y: number) {
  const q = sourceOf(field, x, y);
  return sampleMask(m, img.W, img.H, q.x, q.y);
}

/**
 * Recolours a region keeping its texture: hue and saturation come from the colour, and lightness
 * shifts towards it while every pixel keeps its offset from the region's mean.
 */
function tint(
  img: Img,
  m: Region,
  hex: string,
  o: { strength: number; lightness: number; saturation: number; texture?: number; keepHighlights?: number },
) {
  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts, tl] = rgbToHsl(tr, tg, tb);
  let sum = 0, wsum = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const a = m.a[y * m.w + x];
      if (a <= 0.05) continue;
      const i = ((m.y0 + y) * img.W + m.x0 + x) * 4;
      const r = img.d[i], g = img.d[i + 1], b = img.d[i + 2];
      sum += ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * a; // HSL lightness, as used per pixel below
      wsum += a;
    }
  if (!wsum) return;
  const meanL = sum / wsum / 255;
  const texture = o.texture ?? 1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      let a = m.a[y * m.w + x];
      if (a <= 0.002) continue;
      const i = ((m.y0 + y) * img.W + m.x0 + x) * 4;
      const r = img.d[i], g = img.d[i + 1], b = img.d[i + 2];
      const [hOld, sOld, l] = rgbToHsl(r, g, b);
      const target = clamp01(tl + (l - meanL) * texture);
      const nl = l + (target - l) * o.lightness;
      const ns = clamp01(ts * o.saturation + sOld * (1 - o.saturation));
      // A near-grey colour (grey, white, black) has no real hue — HSL reports 0, which is red — so
      // keep each pixel's own hue and only pull its saturation down; otherwise grey hair turns pink.
      const [nr, ng, nb] = hslToRgb(ts < 0.12 ? hOld : th, ns, nl);
      if (o.keepHighlights) a *= 1 - o.keepHighlights * smoothstep(0.72, 0.95, l);
      a *= o.strength;
      img.d[i] = r + (nr - r) * a;
      img.d[i + 1] = g + (ng - g) * a;
      img.d[i + 2] = b + (nb - b) * a;
    }
}

/** Darkens a region towards a near-black ink (eyeliner, lashes). */
function ink(img: Img, m: Region, strength: number) {
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const a = m.a[y * m.w + x] * strength;
      if (a <= 0.002) continue;
      const i = ((m.y0 + y) * img.W + m.x0 + x) * 4;
      img.d[i] += (22 - img.d[i]) * a;
      img.d[i + 1] += (16 - img.d[i + 1]) * a;
      img.d[i + 2] += (18 - img.d[i + 2]) * a;
    }
}

// ───────────────────────────── skin ─────────────────────────────

function skinMask(img: Img, g: Geo, seg: Segmentation | null, field: Field | null): Region {
  const { p, faceW } = g;
  const oval = smoothClosed(pick(p, L.FACE_OVAL));
  const r = emptyRegion(bounds(oval, faceW * 0.06, img.W, img.H));
  fillPolygon(r, oval, 1);
  const holes: [number[], number][] = [
    [L.EYE_L, 1.45],
    [L.EYE_R, 1.45],
    [L.BROW_L, 1.45],
    [L.BROW_R, 1.45],
    [L.LIPS_OUTER, 1.08],
  ];
  for (const [idx, k] of holes) fillPolygon(r, smoothClosed(scalePoly(pick(p, idx), k)), -1);
  // Feather (then tighten) the edges so they blend into hair and background.
  blurRegion(r, faceW * 0.02);
  for (let k = 0; k < r.a.length; k++) r.a[k] = smoothstep(0.15, 0.85, r.a[k]);
  if (seg) {
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const k = y * r.w + x;
        if (r.a[k] <= 0) continue;
        const skin = maskAt(seg.faceSkin, img, field, r.x0 + x, r.y0 + y) + maskAt(seg.bodySkin, img, field, r.x0 + x, r.y0 + y);
        // Real glasses and other accessories are not skin: retouching would fade their frames.
        const acc = seg.accessories ? maskAt(seg.accessories, img, field, r.x0 + x, r.y0 + y) : 0;
        r.a[k] *= smoothstep(0.15, 0.6, skin) * (1 - smoothstep(0.25, 0.6, acc));
      }
  }
  return r;
}

/** Self-guided filter (He et al.): smooths skin texture but keeps edges where the variance is high. */
function guided(I: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = I.length;
  const II = new Float32Array(n);
  for (let k = 0; k < n; k++) II[k] = I[k] * I[k];
  const mI = boxMean(I, w, h, r);
  const mII = boxMean(II, w, h, r);
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const varI = mII[k] - mI[k] * mI[k];
    A[k] = varI / (varI + eps);
    B[k] = mI[k] - A[k] * mI[k];
  }
  const mA = boxMean(A, w, h, r), mB = boxMean(B, w, h, r);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = mA[k] * I[k] + mB[k];
  return out;
}

function retouch(img: Img, g: Geo, s: Settings, seg: Segmentation | null, field: Field | null) {
  const smooth = v(s, "suavizar"), even = v(s, "manchas"), light = v(s, "iluminar"), wrinkles = v(s, "arrugas");
  if (!smooth && !even && !light && !wrinkles) return;
  const m = skinMask(img, g, seg, field);
  const pl = extract(img, m);
  const { w, h } = m;
  const fw = g.faceW;

  if (wrinkles) {
    // Wrinkles are thin dark lines: the narrow band between a fine and a medium blur. Filling in
    // only where that band is darker than its surroundings keeps pores and highlights intact.
    const fine = gaussian(new Float32Array(pl.Y), w, h, Math.max(0.6, fw * 0.0025));
    const medium = gaussian(new Float32Array(pl.Y), w, h, fw * 0.014);
    const lift = new Float32Array(pl.Y.length);
    for (let k = 0; k < lift.length; k++) lift[k] = Math.max(0, medium[k] - fine[k]);
    // Spread the correction a little so the line's soft edges are covered too.
    gaussian(lift, w, h, Math.max(0.6, fw * 0.003));
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * wrinkles;
      if (a <= 0) continue;
      // Wrinkles are shallow; much deeper dark lines are glasses frames, nostrils or lash lines,
      // which must stay — so the correction fades out as the line gets deeper.
      const l = lift[k];
      pl.Y[k] += l * a * 1.6 * (1 - smoothstep(14, 30, l));
    }
  }

  if (even) {
    // Dark spots and red blotches live in a middle band of detail: lift that band towards the
    // surrounding tone, in luminance (spots) and red chroma (redness).
    const lowY = gaussian(new Float32Array(pl.Y), w, h, fw * 0.03);
    const midY = gaussian(new Float32Array(pl.Y), w, h, fw * 0.005);
    const lowCr = gaussian(new Float32Array(pl.Cr), w, h, fw * 0.03);
    const midCr = gaussian(new Float32Array(pl.Cr), w, h, fw * 0.005);
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * even;
      if (a <= 0) continue;
      const spot = Math.max(0, lowY[k] - midY[k]);
      pl.Y[k] += spot * a * 0.85 * (1 - smoothstep(16, 34, spot)); // spots yes, deep shadows no
      pl.Cr[k] += (lowCr[k] - midCr[k]) * a * 0.7;
    }
  }

  if (smooth) {
    const r = Math.max(1, Math.round(fw * 0.012));
    const e = 5 + 13 * smooth;
    const fine = Math.max(0.5, fw * 0.0016);
    const detail = new Float32Array(pl.Y);
    const blurredFine = gaussian(new Float32Array(pl.Y), w, h, fine);
    for (let k = 0; k < detail.length; k++) detail[k] -= blurredFine[k];
    const sY = guided(pl.Y, w, h, r, e * e);
    const sCb = guided(pl.Cb, w, h, r, (e * 0.6) ** 2);
    const sCr = guided(pl.Cr, w, h, r, (e * 0.6) ** 2);
    const a0 = 0.95 * smooth;
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * a0;
      if (a <= 0) continue;
      // Put back some pore-level grain so skin looks retouched, not plastic.
      pl.Y[k] += (sY[k] - pl.Y[k]) * a + detail[k] * a * 0.35;
      pl.Cb[k] += (sCb[k] - pl.Cb[k]) * a;
      pl.Cr[k] += (sCr[k] - pl.Cr[k]) * a;
    }
  }

  if (light) {
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * light;
      if (a <= 0) continue;
      // Proportional lift with a soft shoulder: the same relative brightening on every skin tone
      // (adding towards white lifted dark skin three times more and turned it ashen).
      const y = pl.Y[k];
      pl.Y[k] = y + Math.min(y * 0.14, (255 - y) * 0.6) * a;
    }
  }
  commit(img, m, pl, m);
}

function underEyes(img: Img, g: Geo, amt: number) {
  const { p, ey, eyeW } = g;
  const angle = Math.atan2(g.ex.y, g.ex.x);
  for (const lid of [L.LOWER_LID_L, L.LOWER_LID_R]) {
    const c = add(p[lid], mul(ey, 0.3 * eyeW));
    const ref = add(p[lid], mul(ey, 0.8 * eyeW));
    const box = bounds([c, ref], eyeW * 0.75, img.W, img.H);
    const m = emptyRegion(box);
    fillEllipse(m, c, eyeW * 0.55, eyeW * 0.24, angle, 1, 0.25);
    const pl = extract(img, box);
    // The cheek just below is the tone the dark circle should match.
    let tY = 0, tCb = 0, tCr = 0, n = 0;
    const rr = eyeW * 0.16;
    for (let y = 0; y < box.h; y++)
      for (let x = 0; x < box.w; x++) {
        if (Math.hypot(box.x0 + x + 0.5 - ref.x, box.y0 + y + 0.5 - ref.y) > rr) continue;
        const k = y * box.w + x;
        tY += pl.Y[k]; tCb += pl.Cb[k]; tCr += pl.Cr[k]; n++;
      }
    if (!n) continue;
    tY /= n; tCb /= n; tCr /= n;
    const sig = eyeW * 0.06;
    const lowY = gaussian(new Float32Array(pl.Y), box.w, box.h, sig);
    const lowCb = gaussian(new Float32Array(pl.Cb), box.w, box.h, sig);
    const lowCr = gaussian(new Float32Array(pl.Cr), box.w, box.h, sig);
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * amt;
      if (a <= 0) continue;
      pl.Y[k] += Math.max(0, tY - lowY[k]) * a * 0.9;
      pl.Cb[k] += (tCb - lowCb[k]) * a * 0.6;
      pl.Cr[k] += (tCr - lowCr[k]) * a * 0.6;
    }
    commit(img, box, pl, m);
  }
}

function teeth(img: Img, g: Geo, amt: number) {
  const inner = smoothClosed(pick(g.p, L.LIPS_INNER));
  const m = emptyRegion(bounds(inner, g.mouthW * 0.05, img.W, img.H));
  fillPolygon(m, scalePoly(inner, 0.97), 1);
  blurRegion(m, g.mouthW * 0.01);
  const pl = extract(img, m);
  for (let k = 0; k < pl.Y.length; k++) {
    let a = m.a[k] * amt;
    if (a <= 0) continue;
    a *= smoothstep(60, 125, pl.Y[k]) * (1 - smoothstep(148, 168, pl.Cr[k])); // skip gums and tongue
    pl.Cb[k] += (128 - pl.Cb[k]) * a * 0.85;
    pl.Cr[k] += (128 - pl.Cr[k]) * a * 0.35;
    pl.Y[k] += (238 - pl.Y[k]) * a * 0.2;
  }
  commit(img, m, pl, m);
}

function eyeRegion(img: Img, g: Geo, idx: number[], grow = 1) {
  const poly = smoothClosed(scalePoly(pick(g.p, idx), grow));
  const m = emptyRegion(bounds(poly, g.eyeW * 0.1, img.W, img.H));
  fillPolygon(m, poly, 1);
  return m;
}

function brightEyes(img: Img, g: Geo, amt: number) {
  for (const idx of [L.EYE_L, L.EYE_R]) {
    const m = blurRegion(eyeRegion(img, g, idx, 0.95), g.eyeW * 0.03);
    const pl = extract(img, m);
    let sum = 0, ws = 0;
    for (let k = 0; k < pl.Y.length; k++) {
      sum += pl.Y[k] * m.a[k];
      ws += m.a[k];
    }
    const mean = ws ? sum / ws : 128;
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * amt;
      if (a <= 0) continue;
      pl.Y[k] += ((pl.Y[k] - mean) * 0.28 + 10) * a;
      if (pl.Y[k] > 95) pl.Cr[k] -= Math.max(0, pl.Cr[k] - 132) * 0.6 * a; // red veins in the white
    }
    commit(img, m, pl, m);
  }
}

function irisColor(img: Img, g: Geo, hex: string, amt: number) {
  const { p } = g;
  if (p.length <= L.IRIS_R + 4) return;
  for (const [c, edge, idx] of [
    [L.IRIS_L, [469, 470, 471, 472], L.EYE_L],
    [L.IRIS_R, [474, 475, 476, 477], L.EYE_R],
  ] as [number, number[], number[]][]) {
    const centre = p[c];
    const r = edge.reduce((acc, i) => acc + dist(p[i], centre), 0) / edge.length;
    const eye = eyeRegion(img, g, idx, 0.98);
    blurRegion(eye, r * 0.06);
    for (let y = 0; y < eye.h; y++)
      for (let x = 0; x < eye.w; x++) {
        const d = Math.hypot(eye.x0 + x + 0.5 - centre.x, eye.y0 + y + 0.5 - centre.y) / r;
        const k = y * eye.w + x;
        // Ring between the pupil and the iris edge.
        eye.a[k] *= (1 - smoothstep(0.92, 1.08, d)) * smoothstep(0.3, 0.45, d);
      }
    tint(img, eye, hex, { strength: amt, lightness: 0.7, saturation: 0.85, texture: 1.2, keepHighlights: 0.9 });
  }
}

// ───────────────────────────── makeup ─────────────────────────────

function lipstick(img: Img, g: Geo, hex: string, amt: number) {
  const outer = smoothClosed(pick(g.p, L.LIPS_OUTER));
  const inner = smoothClosed(pick(g.p, L.LIPS_INNER));
  const m = emptyRegion(bounds(outer, g.mouthW * 0.06, img.W, img.H));
  fillPolygon(m, outer, 1);
  fillPolygon(m, inner, -1);
  blurRegion(m, g.mouthW * 0.012);
  tint(img, m, hex, { strength: amt, lightness: 0.6, saturation: 0.85, texture: 1, keepHighlights: 0.6 });
}

function blush(img: Img, g: Geo, hex: string, amt: number) {
  const { p, ex, ey, faceW } = g;
  const [cr, cg, cb] = hexToRgb(hex);
  const baseAngle = Math.atan2(ex.y, ex.x);
  for (const [i, side] of [
    [L.BLUSH_L, -1],
    [L.BLUSH_R, 1],
  ] as const) {
    const c = add(add(p[i], mul(ex, side * 0.03 * faceW)), mul(ey, -0.01 * faceW));
    const box = bounds([c], faceW * 0.16, img.W, img.H);
    const m = emptyRegion(box);
    fillEllipse(m, c, faceW * 0.13, faceW * 0.085, baseAngle - side * 0.35, 1, 0);
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const a = m.a[y * m.w + x] * amt * 0.6;
        if (a <= 0.002) continue;
        const k = ((m.y0 + y) * img.W + m.x0 + x) * 4;
        img.d[k] += (softLight(img.d[k], cr) - img.d[k]) * a;
        img.d[k + 1] += (softLight(img.d[k + 1], cg) - img.d[k + 1]) * a;
        img.d[k + 2] += (softLight(img.d[k + 2], cb) - img.d[k + 2]) * a;
      }
  }
}

function lidLine(g: Geo, lid: number[]) {
  const pts = smoothOpen(pick(g.p, lid), 4);
  return pts.map((q) => add(q, mul(g.ey, -0.012 * g.eyeW)));
}

function eyeliner(img: Img, g: Geo, amt: number) {
  const { p, ey, eyeW } = g;
  for (const [lid, outer, inner] of [
    [L.UPPER_LID_L, L.EYE_OUTER_L, L.EYE_INNER_L],
    [L.UPPER_LID_R, L.EYE_OUTER_R, L.EYE_INNER_R],
  ] as [number[], number, number][]) {
    const line = lidLine(g, lid); // starts at the outer corner
    const m = emptyRegion(bounds(line, eyeW * 0.5, img.W, img.H));
    const base = eyeW * (0.035 + 0.04 * amt);
    strokePolyline(m, line, (t) => base * (1 - 0.75 * t) + 0.6, 1);
    const dir = norm(add(mul(norm(sub(p[outer], p[inner])), 0.9), mul(ey, -0.5)));
    const tip = add(line[0], mul(dir, eyeW * (0.12 + 0.18 * amt)));
    strokePolyline(m, [line[0], mid(line[0], tip), tip], (t) => base * (1 - t) + 0.5, 1);
    blurRegion(m, Math.max(0.4, eyeW * 0.006));
    ink(img, m, 0.92);
  }
}

function lashes(img: Img, g: Geo, amt: number) {
  const { p, ey, eyeW } = g;
  for (const [lid, outer, inner] of [
    [L.UPPER_LID_L, L.EYE_OUTER_L, L.EYE_INNER_L],
    [L.UPPER_LID_R, L.EYE_OUTER_R, L.EYE_INNER_R],
  ] as [number[], number, number][]) {
    const line = lidLine(g, lid);
    const m = emptyRegion(bounds(line, eyeW * 0.45, img.W, img.H));
    const outward = norm(sub(p[outer], p[inner]));
    strokePolyline(m, line, () => eyeW * 0.03 + 0.5, 1);
    const N = 22;
    for (let k = 0; k < N; k++) {
      const t = 0.02 + (k / (N - 1)) * 0.9; // 0 = outer corner
      const fi = t * (line.length - 1);
      const i0 = Math.floor(fi), i1 = Math.min(line.length - 1, i0 + 1);
      const b = add(line[i0], mul(sub(line[i1], line[i0]), fi - i0));
      const len = eyeW * (0.1 + 0.14 * Math.sin(Math.PI * (1 - t) * 0.85 + 0.25)) * (0.5 + 0.6 * amt);
      const dir = norm(add(mul(ey, -1), mul(outward, 0.9 * (1 - t))));
      const curl = mul(outward, len * 0.25);
      const lash = [b, add(add(b, mul(dir, len * 0.55)), mul(curl, 0.3)), add(add(b, mul(dir, len)), curl)];
      strokePolyline(m, smoothOpen(lash, 3), (s) => eyeW * 0.016 * (1 - s) + 0.35, 1);
    }
    blurRegion(m, Math.max(0.3, eyeW * 0.004));
    ink(img, m, 0.85 * Math.min(1, 0.4 + amt));
  }
}

function defineBrows(img: Img, g: Geo, amt: number) {
  for (const idx of [L.BROW_L, L.BROW_R]) {
    const poly = smoothClosed(pick(g.p, idx));
    const m = emptyRegion(bounds(poly, g.eyeW * 0.2, img.W, img.H));
    fillPolygon(m, poly, 1);
    blurRegion(m, g.eyeW * 0.05);
    const pl = extract(img, m);
    let sum = 0, ws = 0;
    for (let k = 0; k < pl.Y.length; k++) {
      sum += pl.Y[k] * m.a[k];
      ws += m.a[k];
    }
    const mean = ws ? sum / ws : 100;
    for (let k = 0; k < pl.Y.length; k++) {
      const a = m.a[k] * amt;
      if (a <= 0) continue;
      pl.Y[k] = mean + (pl.Y[k] - mean) * (1 + 0.35 * a);
      pl.Y[k] *= 1 - 0.3 * a;
    }
    commit(img, m, pl, m);
  }
}

// ───────────────────────────── accessories ─────────────────────────────

/** Smooth value noise in [0,1] (hash on a grid, bilinear), for tortoiseshell and stubble. */
function noise(x: number, y: number, cell: number, seed = 0) {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy;
  const h = (a: number, b: number) => {
    let n = (a * 374761393 + b * 668265263 + seed * 982451653) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
  const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
  return top + (bot - top) * sy;
}

type GlassStyle = { w: number; h: number; n: number; thick: number; dark: boolean; shape: (u: number, v: number) => [number, number] };

const GLASS_STYLES: Record<string, GlassStyle> = {
  clasicas: { w: 1.85, h: 1.25, n: 3.4, thick: 0.11, dark: false, shape: (u, v) => [u, v * (1 - 0.08 * u)] },
  redondas: { w: 1.7, h: 1.6, n: 2, thick: 0.06, dark: false, shape: (u, v) => [u, v] },
  aviador: { w: 1.95, h: 1.55, n: 2.6, thick: 0.035, dark: false, shape: (u, v) => [u, v > 0 ? v * (1.08 - 0.22 * u) : v * 0.85] },
  gato: { w: 1.9, h: 1.25, n: 3, thick: 0.1, dark: false, shape: (u, v) => [u * (v < 0 ? 1 + 0.08 * Math.max(0, u) : 1), v < 0 ? v - 0.42 * Math.max(0, u) ** 2 : v * (1 - 0.15 * u)] },
  sol: { w: 2.0, h: 1.5, n: 3.2, thick: 0.12, dark: true, shape: (u, v) => [u, v * (1 - 0.1 * u)] },
  solAviador: { w: 2.0, h: 1.65, n: 2.6, thick: 0.035, dark: true, shape: (u, v) => [u, v > 0 ? v * (1.1 - 0.22 * u) : v * 0.85] },
};

const FRAME_RGB: Record<string, RGB> = { "": [18, 18, 20], carey: [74, 42, 20], dorada: [201, 162, 74], plateada: [184, 188, 194], transparente: [232, 232, 232] };

function glasses(img: Img, g: Geo, style: GlassStyle, color: string) {
  const { p, ex, ey, eyeW } = g;
  const up = mul(ey, -1);
  // Glasses sit on the face, not on the gaze: centre each lens between the eye's corners. On a
  // three-quarter view the far eye looks narrower, and so should its lens.
  const centres = [mid(p[L.EYE_OUTER_L], p[L.EYE_INNER_L]), mid(p[L.EYE_OUTER_R], p[L.EYE_INNER_R])];
  const widths = [dist(p[L.EYE_OUTER_L], p[L.EYE_INNER_L]), dist(p[L.EYE_OUTER_R], p[L.EYE_INNER_R])].map((w) => Math.max(w, eyeW * 0.55));
  const sides = [p[L.FACE_SIDE_L], p[L.FACE_SIDE_R]];
  const lenses: P[][] = [];
  const frames: P[][] = [];
  const at = (c: P, out: number, u: number, v: number, w = eyeW) => {
    const [su, sv] = style.shape(u, v);
    return add(add(c, mul(ex, out * su * style.w * w * 0.5)), mul(ey, sv * style.h * eyeW * 0.5));
  };
  centres.forEach((c0, k) => {
    const wk = widths[k];
    const out = k === 0 ? -1 : 1; // outward from the nose
    const c = add(c0, mul(up, 0.06 * eyeW));
    const poly: P[] = [];
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      poly.push(at(c, out, Math.sign(ct) * Math.abs(ct) ** (2 / style.n), Math.sign(st) * Math.abs(st) ** (2 / style.n), wk));
    }
    lenses.push(poly);
    frames.push([...poly, poly[0]]);
    // Temple arm from the top outer corner back towards the ear, ending at the side of the face.
    const hinge = at(c, out, 1, -0.45, wk);
    const reach = Math.max(0, dot(sub(sides[k], hinge), mul(ex, out))) * 0.97;
    if (reach > 0) frames.push([hinge, add(hinge, mul(ex, out * reach))]);
  });
  // Bridge over the nose.
  const lc = add(centres[0], mul(up, 0.06 * eyeW)), rc = add(centres[1], mul(up, 0.06 * eyeW));
  const bl = at(lc, -1, -0.97, -0.35, widths[0]), br = at(rc, 1, -0.97, -0.35, widths[1]);
  frames.push(smoothOpen([bl, add(mid(bl, br), mul(up, 0.12 * eyeW)), br], 6));

  const all = [...lenses.flat(), ...frames.flat()];
  const box = bounds(all, eyeW * 0.5, img.W, img.H);
  const frameM = emptyRegion(box), lensM = emptyRegion(box);
  for (const l of lenses) fillPolygon(lensM, l, 1);
  const thick = Math.max(1.2, style.thick * eyeW);
  for (const f of frames) strokePolyline(frameM, f, () => (f.length === 2 ? thick * 0.7 : thick), 1);

  // Soft shadow of the frame on the skin, cast slightly downwards.
  const shadow = blurRegion({ ...frameM, a: new Float32Array(frameM.a) }, eyeW * 0.06);
  const off = Math.round(eyeW * 0.07);
  const [fr, fg, fb] = FRAME_RGB[color] ?? FRAME_RGB[""];
  const clear = color === "transparente";
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const k = y * box.w + x;
      const i = ((box.y0 + y) * img.W + box.x0 + x) * 4;
      const fm = frameM.a[k];
      const sm = y - off >= 0 ? shadow.a[(y - off) * box.w + x] : 0;
      const lm = lensM.a[k] * (1 - fm);
      let r = img.d[i], gg = img.d[i + 1], b = img.d[i + 2];
      const shade = 1 - sm * (style.dark ? 0.35 : 0.25) * (1 - fm);
      r *= shade; gg *= shade; b *= shade;
      if (lm > 0) {
        // Vertical position inside the lens (0 top → 1 bottom) for gradients and reflections.
        const py = box.y0 + y + 0.5, px = box.x0 + x + 0.5;
        const c = px < (lc.x + rc.x) / 2 === lc.x < rc.x ? lc : rc;
        const vy = clamp01(0.5 + dot(sub({ x: px, y: py }, c), ey) / (style.h * eyeW));
        const vx = dot(sub({ x: px, y: py }, c), ex) / (style.w * eyeW);
        const streak = Math.max(0, 1 - Math.abs(vx + (vy - 0.5) * 0.9 + 0.12) / 0.07) * (1 - vy) * 0.5;
        if (style.dark) {
          const a = lm * (0.95 - 0.2 * vy);
          r += (30 - r) * a; gg += (26 - gg) * a; b += (24 - b) * a;
          r += (255 - r) * streak * 0.18 * lm; gg += (255 - gg) * streak * 0.18 * lm; b += (255 - b) * streak * 0.18 * lm;
        } else {
          r *= 1 - 0.04 * lm; gg *= 1 - 0.04 * lm; b *= 1 - 0.03 * lm;
          r += (255 - r) * streak * 0.12 * lm; gg += (255 - gg) * streak * 0.12 * lm; b += (255 - b) * streak * 0.12 * lm;
        }
      }
      if (fm > 0) {
        let cr = fr, cg = fg, cb = fb;
        if (color === "carey") {
          const n = noise(box.x0 + x, box.y0 + y, eyeW * 0.09, 7) * 0.65 + noise(box.x0 + x, box.y0 + y, eyeW * 0.035, 3) * 0.35;
          const t = smoothstep(0.35, 0.75, n);
          cr = 30 + t * 150; cg = 16 + t * 86; cb = 8 + t * 30;
        }
        // Light from above: a little brighter at the top of each rim.
        const lit = 1 + 0.18 * (1 - clamp01((y - 0) / Math.max(1, box.h)));
        const a = fm * (clear ? 0.4 : 0.96);
        r += (cr * lit - r) * a; gg += (cg * lit - gg) * a; b += (cb * lit - b) * a;
      }
      img.d[i] = r; img.d[i + 1] = gg; img.d[i + 2] = b;
    }
}

/** Beard area: jaw line below, cheeks and the upper lip above, mouth cut out. */
const BEARD = [361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 207, 92, 165, 167, 164, 393, 391, 322, 427];

function stubble(img: Img, g: Geo, amt: number) {
  const { p, faceW } = g;
  const poly = smoothClosed(pick(p, BEARD));
  const m = emptyRegion(bounds(poly, faceW * 0.05, img.W, img.H));
  fillPolygon(m, poly, 1);
  fillPolygon(m, smoothClosed(scalePoly(pick(p, L.LIPS_OUTER), 1.06)), -1);
  blurRegion(m, faceW * 0.025);
  const pl = extract(img, m);
  const cell = Math.max(0.8, faceW * 0.0032);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const k = y * m.w + x;
      const a = m.a[k] * amt;
      if (a <= 0.002) continue;
      const gx = m.x0 + x, gy = m.y0 + y;
      const dots = smoothstep(0.5, 0.8, noise(gx, gy, cell, 11)) * 0.7 + smoothstep(0.55, 0.85, noise(gx + 17, gy - 5, cell * 0.7, 5)) * 0.3;
      // The shaved-shadow tone (darker, slightly blue-grey) plus the dots of the hairs.
      pl.Y[k] *= 1 - a * (0.14 + 0.38 * dots);
      pl.Cb[k] += 3 * a;
      pl.Cr[k] -= 4 * a;
    }
  commit(img, m, pl, m);
}

function lighting(img: Img, geos: Geo[], kind: string, amt: number) {
  const { W, H, d } = img;
  type Lit = { m: Region; c: P; ex: P; r: number };
  const lits: Lit[] = geos.map((g) => {
    const oval = smoothClosed(scalePoly(pick(g.p, L.FACE_OVAL), 1.08));
    const m = emptyRegion(bounds(oval, g.faceW * 0.15, W, H));
    fillPolygon(m, oval, 1);
    blurRegion(m, g.faceW * 0.06);
    const eyes = mid(centroid(pick(g.p, L.EYE_L)), centroid(pick(g.p, L.EYE_R)));
    return { m, c: add(eyes, mul(g.ey, 0.25 * g.faceH)), ex: g.ex, r: g.faceW * 0.62 };
  });
  /** Face weight here, and position across / distance from the faces, blended by weight. */
  const faceAt = (x: number, y: number) => {
    let best = 0, wsum = 0, u = 0, rad = 0;
    for (const l of lits) {
      const lx = x - l.m.x0, ly = y - l.m.y0;
      if (lx < 0 || ly < 0 || lx >= l.m.w || ly >= l.m.h) continue;
      const v = l.m.a[ly * l.m.w + lx];
      if (v <= 0) continue;
      best = Math.max(best, v);
      wsum += v;
      u += v * (((x - l.c.x) * l.ex.x + (y - l.c.y) * l.ex.y) / l.r);
      rad += v * (Math.hypot(x - l.c.x, y - l.c.y) / l.r);
    }
    return wsum ? { m: best, u: u / wsum, rad: rad / wsum } : { m: 0, u: 0, rad: 1 };
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const { m, u: uFace, rad } = faceAt(x, y);
      let r = d[i], g = d[i + 1], b = d[i + 2];
      // Position across the face (−1 image-left … 1 image-right), easing into the picture-wide
      // direction outside the face so there is no step at its edge.
      const gxAll = (x / W) * 2 - 1;
      const u = gxAll + (uFace - gxAll) * smoothstep(0, 0.6, m);
      const gx = gxAll;
      if (kind === "estudio") {
        const key = m * Math.max(0, 1 - rad * rad);
        const k = 1 + amt * (0.16 * key);
        r = r * k + amt * m * (255 - r) * 0.06;
        g = g * k + amt * m * (255 - g) * 0.06;
        b = b * k + amt * m * (255 - b) * 0.06;
      } else if (kind === "lateral" || kind === "dorada") {
        const side = -Math.max(-1, Math.min(1, u));
        const k = 1 + amt * (0.24 * side * Math.max(m, 0.35));
        r *= k; g *= k; b *= k;
        if (kind === "dorada") {
          const warm = amt * (0.5 + 0.5 * Math.max(0, side));
          r += 22 * warm; g += 9 * warm; b -= 18 * warm;
        }
      } else if (kind === "dramatica") {
        const k = 1 - amt * 0.5 * (1 - m) * smoothstep(0.1, 1, Math.hypot(gx, (y / H) * 2 - 1) * 0.9 + 0.2);
        const key = 1 + amt * 0.12 * m * Math.max(0, 1 - rad * rad);
        r = 128 + (r * key * k - 128) * (1 + 0.15 * amt);
        g = 128 + (g * key * k - 128) * (1 + 0.15 * amt);
        b = 128 + (b * key * k - 128) * (1 + 0.15 * amt);
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
}

// ───────────────────────────── segmentation ─────────────────────────────

type Box = { x0: number; y0: number; x1: number; y1: number };

function hairColor(img: Img, seg: Segmentation, field: Field | null, hex: string, amt: number, limit?: Box) {
  // Work only where there is hair (found on the small mask), plus a margin for the reshaping.
  const mk = seg.hair;
  let mx0 = mk.width, my0 = mk.height, mx1 = -1, my1 = -1;
  for (let y = 0; y < mk.height; y++)
    for (let x = 0; x < mk.width; x++)
      if (mk.data[y * mk.width + x] >= 0.12) {
        if (x < mx0) mx0 = x;
        if (x > mx1) mx1 = x;
        if (y < my0) my0 = y;
        if (y > my1) my1 = y;
      }
  if (mx1 < 0) return;
  const sx = img.W / mk.width, sy = img.H / mk.height, pad = Math.max(img.W, img.H) * 0.03;
  let x0 = Math.max(0, Math.floor(mx0 * sx - pad)), y0 = Math.max(0, Math.floor(my0 * sy - pad));
  let x1 = Math.min(img.W, Math.ceil((mx1 + 1) * sx + pad)), y1 = Math.min(img.H, Math.ceil((my1 + 1) * sy + pad));
  if (limit) {
    x0 = Math.max(x0, Math.floor(limit.x0)); y0 = Math.max(y0, Math.floor(limit.y0));
    x1 = Math.min(x1, Math.ceil(limit.x1)); y1 = Math.min(y1, Math.ceil(limit.y1));
  }
  if (x1 <= x0 || y1 <= y0) return;
  const m = emptyRegion({ x0, y0, w: x1 - x0, h: y1 - y0 });
  let any = false;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const hm = maskAt(seg.hair, img, field, x, y);
      if (hm < 0.12) continue;
      const fs = maskAt(seg.faceSkin, img, field, x, y);
      m.a[(y - y0) * m.w + (x - x0)] = smoothstep(0.2, 0.8, hm) * (1 - smoothstep(0.3, 0.7, fs));
      any = true;
    }
  if (!any) return;
  tint(img, m, hex, { strength: Math.min(0.95, amt), lightness: 0.82, saturation: 0.8, texture: 1.15, keepHighlights: 0.25 });
}

function background(img: Img, seg: Segmentation, field: Field | null, blurAmt: number, hex: string, colorAmt: number) {
  const { W, H, d } = img;
  const bg = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) bg[y * W + x] = smoothstep(0.3, 0.8, maskAt(seg.background, img, field, x, y));

  if (blurAmt > 0) {
    const radius = blurAmt * 0.028 * Math.max(W, H);
    // Blur a smaller copy (much faster, same look for a strong blur), weighting by the background
    // mask so the person's colours don't bleed into the blurred background.
    const f = Math.max(1, Math.floor(radius / 6));
    const w = Math.ceil(W / f), h = Math.ceil(H / f);
    const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h), A = new Float32Array(w * h);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = Math.floor(y / f) * w + Math.floor(x / f);
        const i = (y * W + x) * 4;
        const a = bg[y * W + x] + 0.002;
        R[k] += d[i] * a; G[k] += d[i + 1] * a; B[k] += d[i + 2] * a; A[k] += a;
      }
    const sig = radius / f;
    gaussian(R, w, h, sig); gaussian(G, w, h, sig); gaussian(B, w, h, sig); gaussian(A, w, h, sig);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const a = bg[y * W + x];
        if (a <= 0.002) continue;
        const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
        const s = (arr: Float32Array) => {
          const top = arr[y0 * w + x0] + (arr[y0 * w + x1] - arr[y0 * w + x0]) * tx;
          const bot = arr[y1 * w + x0] + (arr[y1 * w + x1] - arr[y1 * w + x0]) * tx;
          return top + (bot - top) * ty;
        };
        const wa = s(A) || 1;
        const i = (y * W + x) * 4;
        d[i] += (s(R) / wa - d[i]) * a;
        d[i + 1] += (s(G) / wa - d[i + 1]) * a;
        d[i + 2] += (s(B) / wa - d[i + 2]) * a;
      }
    }
  }

  if (hex && colorAmt > 0) {
    const [r, g, b] = hexToRgb(hex);
    for (let k = 0; k < W * H; k++) {
      const a = bg[k] * colorAmt;
      if (a <= 0.002) continue;
      const i = k * 4;
      d[i] += (r - d[i]) * a;
      d[i + 1] += (g - d[i + 1]) * a;
      d[i + 2] += (b - d[i + 2]) * a;
    }
  }
}

// ───────────────────────────── global ─────────────────────────────

type RGB = [number, number, number];

/**
 * Colour filters are affine maps of RGB (scales, offsets, saturation, contrast), so each one is a
 * 3×4 matrix built once, and blending with its intensity is just interpolating matrices. Row-major:
 * [r·, g·, b·, offset] for each output channel.
 */
type Affine = number[];
const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
/** `b` applied after `a`. */
function compose(b: Affine, a: Affine): Affine {
  const o: Affine = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 4 + j] = b[i * 4] * a[j] + b[i * 4 + 1] * a[4 + j] + b[i * 4 + 2] * a[8 + j];
    o[i * 4 + 3] = b[i * 4] * a[3] + b[i * 4 + 1] * a[7] + b[i * 4 + 2] * a[11] + b[i * 4 + 3];
  }
  return o;
}
const chain = (...ms: Affine[]) => ms.reduce((acc, m) => compose(m, acc), IDENTITY);
/** Saturation k around the pixel's luma (0 = grey, 1 = unchanged). */
const satM = (k: number): Affine => {
  const w = [0.299, 0.587, 0.114];
  return [0, 1, 2].flatMap((i) => [...w.map((wj, j) => (1 - k) * wj + (i === j ? k : 0)), 0]);
};
const conM = (k: number, pivot = 128): Affine => [k, 0, 0, pivot * (1 - k), 0, k, 0, pivot * (1 - k), 0, 0, k, pivot * (1 - k)];
const diagM = (r: number, g: number, b: number, or = 0, og = 0, ob = 0): Affine => [r, 0, 0, or, 0, g, 0, og, 0, 0, b, ob];

const FILTERS: Record<string, Affine> = {
  vivo: chain(satM(1.3), conM(1.08)),
  calido: chain(diagM(1.06, 1.01, 0.9, 8, 3, 0), satM(1.05)),
  frio: diagM(0.93, 1.0, 1.07, 0, 2, 10),
  dorado: chain(diagM(1.05, 1.02, 0.88, 14, 7, 0), conM(1.06)),
  vintage: chain(satM(0.7), diagM(0.86, 0.84, 0.78, 30, 24, 26)),
  drama: chain(satM(0.82), conM(1.32, 118), diagM(0.95, 0.95, 0.95)),
  bn: chain(satM(0), conM(1.1)),
  noir: chain(satM(0), diagM(0.94, 0.94, 0.94), conM(1.45, 120)),
};

function globalAdjust(img: Img, s: Settings) {
  const bright = v(s, "brillo"), contrast = v(s, "contraste"), satur = v(s, "saturacion"), warm = v(s, "calidez");
  const hi = v(s, "luces"), sh = v(s, "sombras"), sharp = v(s, "nitidez"), vig = v(s, "vineta");
  const filterId = str(s, "filtro");
  const filter = Object.hasOwn(FILTERS, filterId) ? FILTERS[filterId] : undefined;
  const fAmt = v(s, "filtroIntensidad");
  const { W, H, d } = img;
  const n = W * H;

  if (sharp > 0) {
    // Unsharp mask on luma; the blurred copy is the only full-size buffer kept.
    const blurred = new Float32Array(n);
    for (let k = 0; k < n; k++) blurred[k] = luma(d[k * 4], d[k * 4 + 1], d[k * 4 + 2]);
    gaussian(blurred, W, H, Math.max(0.8, Math.max(W, H) / 1500));
    const amt = sharp * 1.6;
    for (let k = 0; k < n; k++) {
      const i = k * 4;
      const delta = (luma(d[i], d[i + 1], d[i + 2]) - blurred[k]) * amt;
      d[i] = d[i] + delta;
      d[i + 1] = d[i + 1] + delta;
      d[i + 2] = d[i + 2] + delta;
    }
  }

  const useFilter = !!filter && fAmt > 0;
  if (!bright && !contrast && !satur && !warm && !hi && !sh && !vig && !useFilter) return;

  // Brightness (gamma), contrast and warmth are per channel: one lookup table each.
  const gamma = Math.pow(2, -bright * 0.75);
  const kc = 1 + contrast * (contrast > 0 ? 0.55 : 0.45);
  const lut = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let ch = 0; ch < 3; ch++)
    for (let x = 0; x < 256; x++) lut[ch][x] = 128 + (255 * Math.pow(x / 255, gamma) - 128) * kc + warm * (ch === 0 ? 16 : ch === 1 ? 3 : -16);
  const [lr, lg, lb] = lut;

  // Shadows/highlights depend on luma: a table over 1024 luma steps.
  const shLut = new Float32Array(1024);
  if (hi || sh)
    for (let i = 0; i < 1024; i++) {
      const l = i / 1023;
      shLut[i] = 255 * (sh * 0.32 * (1 - smoothstep(0, 0.55, l)) + hi * 0.3 * smoothstep(0.45, 1, l));
    }

  // Saturation and the filter (blended by its intensity) fold into one affine map.
  let m = satur ? satM(1 + satur) : IDENTITY;
  if (useFilter) m = compose(IDENTITY.map((x, i) => x + (filter![i] - x) * fAmt), m);
  const affine = m.some((x, i) => x !== IDENTITY[i]);
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] = m;

  // Vignette depends on the normalised squared distance to the centre: another table.
  const vigLut = new Float32Array(1025);
  if (vig) for (let i = 0; i <= 1024; i++) vigLut[i] = 1 - vig * 0.6 * smoothstep(0.35, 1.05, Math.sqrt(i / 1024));
  const cx = W / 2, cy = H / 2;

  for (let y = 0; y < H; y++) {
    const ny = (y - cy) / cy;
    const ny2 = ny * ny;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
      if (hi || sh) {
        let li = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * 1023;
        li = li < 0 ? 0 : li > 1023 ? 1023 : li;
        const dl = shLut[li | 0];
        r += dl; g += dl; b += dl;
      }
      if (affine) {
        const nr = m0 * r + m1 * g + m2 * b + m3;
        const ng = m4 * r + m5 * g + m6 * b + m7;
        b = m8 * r + m9 * g + m10 * b + m11;
        r = nr;
        g = ng;
      }
      if (vig) {
        const nx = (x - cx) / cx;
        let q = ((nx * nx + ny2) / 2) * 1024;
        q = q > 1024 ? 1024 : q;
        const f = vigLut[q | 0];
        r *= f; g *= f; b *= f;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
    }
  }
}

// ───────────────────────────── pipeline ─────────────────────────────

export function needsSegmentation(s: Settings) {
  return !!(
    num(s, "desenfoque") ||
    (str(s, "fondoColor") && num(s, "fondoIntensidad")) ||
    (str(s, "cabelloColor") && num(s, "cabelloIntensidad")) ||
    // Skin retouch uses the skin/hair/accessory masks to leave beards, fringes and glasses alone.
    num(s, "suavizar") || num(s, "manchas") || num(s, "arrugas") || num(s, "iluminar")
  );
}

/** Settings that only touch the last stage (light and colour): changing them reuses the rest. */
export const LATE_KEYS = ["luz", "luzIntensidad", "brillo", "contraste", "saturacion", "calidez", "luces", "sombras", "nitidez", "vineta", "filtro", "filtroIntensidad"];
/** Settings the engine never reads (they only drive the UI). */
const UI_KEYS = ["look", "lookIntensidad"];

/** The key of everything stage one depends on, besides the photo and its analysis. */
export function baseKey(s: Settings) {
  return JSON.stringify(Object.keys(s).filter((k) => !LATE_KEYS.includes(k) && !UI_KEYS.includes(k)).sort().map((k) => [k, s[k]]));
}

export type Stage = { d: Uint8ClampedArray; W: number; H: number; warped: Geo[] };

/** Which faces get the face effects: one (by index, largest first) or all of them (-1). */
function chosen<T>(all: T[], s: Settings): T[] {
  const i = typeof s.cara === "number" ? s.cara : 0;
  if (i < 0 || all.length <= 1) return all;
  return all[i] ? [all[i]] : all.slice(0, 1);
}

/** Stage one: reshaping, hair, face retouch and makeup, background and glasses. */
export function renderBase({ data, width: W, height: H, faces, seg, settings: s }: RenderInput): Stage {
  const geos = chosen(faces, s).map((f) => geometry(f.map((q) => ({ x: q.x * W, y: q.y * H }))));

  const { field, ops } = buildSafeField(geos.flatMap((g) => warpOps(g, s)), W, H);
  const img: Img = { d: field ? applyField(data, W, H, field) : new Uint8ClampedArray(data), W, H };
  // After reshaping, every mask is drawn where the features now are.
  const warped = ops.length ? geos.map((g) => geometry(g.p.map((q) => forward(ops, q)))) : geos;

  if (seg && str(s, "cabelloColor") && num(s, "cabelloIntensidad")) {
    // With one face chosen among several, only that person's hair: a generous box around the head.
    const limit = faces.length > 1 && warped.length === 1 ? headBox(warped[0]) : undefined;
    hairColor(img, seg, field, str(s, "cabelloColor"), v(s, "cabelloIntensidad"), limit);
  }

  for (const g of warped) {
    retouch(img, g, s, seg, field);
    if (num(s, "ojeras")) underEyes(img, g, v(s, "ojeras"));
    if (num(s, "dientes")) teeth(img, g, v(s, "dientes"));
    if (num(s, "brilloOjos")) brightEyes(img, g, v(s, "brilloOjos"));
    if (str(s, "ojosColor") && num(s, "ojosIntensidad")) irisColor(img, g, str(s, "ojosColor"), v(s, "ojosIntensidad"));
    if (str(s, "labialColor") && num(s, "labial")) lipstick(img, g, str(s, "labialColor"), v(s, "labial"));
    if (str(s, "ruborColor") && num(s, "rubor")) blush(img, g, str(s, "ruborColor"), v(s, "rubor"));
    if (num(s, "cejasDef")) defineBrows(img, g, v(s, "cejasDef"));
    if (num(s, "delineado")) eyeliner(img, g, v(s, "delineado"));
    if (num(s, "pestanas")) lashes(img, g, v(s, "pestanas"));
    if (num(s, "barba")) stubble(img, g, v(s, "barba"));
  }

  if (seg && (num(s, "desenfoque") || (str(s, "fondoColor") && num(s, "fondoIntensidad"))))
    background(img, seg, field, v(s, "desenfoque"), str(s, "fondoColor"), v(s, "fondoIntensidad"));

  // Light falls on the face and on the glasses alike, so glasses go before the light.
  const glassStyle = GLASS_STYLES[str(s, "gafas")] as GlassStyle | undefined;
  if (glassStyle) for (const g of warped) glasses(img, g, glassStyle, str(s, "gafasColor"));
  return { d: img.d, W, H, warped };
}

/**
 * Stage two: light, then colour adjustments. Works on a copy so a cached stage one can be reused,
 * or in place (`consume`) when the stage won't be needed again, saving a full-size copy.
 */
export function finish(stage: Stage, s: Settings, consume = false): Uint8ClampedArray {
  const img: Img = { d: consume ? stage.d : new Uint8ClampedArray(stage.d), W: stage.W, H: stage.H };
  if (str(s, "luz") && num(s, "luzIntensidad")) lighting(img, stage.warped, str(s, "luz"), v(s, "luzIntensidad"));
  globalAdjust(img, s);
  return img.d;
}

export function render(input: RenderInput): Uint8ClampedArray {
  return finish(renderBase(input), input.settings, true);
}

function headBox(g: Geo): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of g.p) {
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  }
  const w = x1 - x0, h = y1 - y0;
  return { x0: x0 - w * 0.9, y0: y0 - h * 1.1, x1: x1 + w * 0.9, y1: y1 + h * 1.6 };
}
