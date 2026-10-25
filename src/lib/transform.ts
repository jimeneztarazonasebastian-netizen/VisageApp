// Crop, rotate and flip. The result becomes a new base photo (like an AI edit), at full resolution,
// so everything else keeps working on it and it can be undone.
import { EXPORT_MAX_PIXELS, toBlob, type Photo } from "./photo";
import type { Point } from "./vision";

export type Transform = { rot: number; flip: boolean; aspect: string; zoom: number };
export const NO_TRANSFORM: Transform = { rot: 0, flip: false, aspect: "", zoom: 0 };

export const ASPECTS = [
  { id: "", name: "Original" },
  { id: "1:1", name: "1:1" },
  { id: "4:5", name: "4:5" },
  { id: "3:4", name: "3:4" },
  { id: "9:16", name: "9:16" },
  { id: "16:9", name: "16:9" },
];

export const isIdentity = (t: Transform) => !((t.rot % 360) || t.flip || t.aspect || t.zoom);

export function describe(t: Transform) {
  const parts: string[] = [];
  if (t.rot % 360) parts.push(`Girar ${t.rot % 360}°`);
  if (t.flip) parts.push("Voltear");
  if (t.aspect) parts.push(t.aspect);
  if (t.zoom) parts.push(`Acercar ${t.zoom}`);
  return parts.join(" · ") || "Recorte";
}

/** A point of the source (normalised) in the rotated/flipped picture (normalised). */
function mapPoint(p: Point, rot: number, flip: boolean): Point {
  let q = p;
  if (rot === 90) q = { x: 1 - p.y, y: p.x };
  else if (rot === 180) q = { x: 1 - p.x, y: 1 - p.y };
  else if (rot === 270) q = { x: p.y, y: 1 - p.x };
  return flip ? { x: 1 - q.x, y: q.y } : q;
}

/**
 * Applies the transform to the photo's full-resolution image. The crop keeps `focus` (e.g. the
 * chosen face, normalised in the source) as centred as the picture allows.
 */
export async function transformPhoto(src: Photo, t: Transform, focus?: Point): Promise<Blob> {
  const rot = ((t.rot % 360) + 360) % 360;
  const W = src.width, H = src.height;
  const RW = rot % 180 ? H : W, RH = rot % 180 ? W : H;

  // Largest box of the requested aspect inside the rotated picture, then tightened by the zoom.
  const [aw, ah] = t.aspect ? t.aspect.split(":").map(Number) : [RW, RH];
  let cw = RW, ch = (RW * ah) / aw;
  if (ch > RH) {
    ch = RH;
    cw = (RH * aw) / ah;
  }
  const z = 1 - (Math.min(100, Math.max(0, t.zoom)) / 100) * 0.6;
  cw *= z;
  ch *= z;
  const f = mapPoint(focus ?? { x: 0.5, y: 0.5 }, rot, t.flip);
  const cx = Math.min(RW - cw, Math.max(0, f.x * RW - cw / 2));
  const cy = Math.min(RH - ch, Math.max(0, f.y * RH - ch / 2));

  // Output at the crop's own resolution, within what iOS canvases allow.
  const k = Math.min(1, Math.sqrt(EXPORT_MAX_PIXELS / (cw * ch)));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);
  if (t.flip) {
    ctx.translate(RW, 0);
    ctx.scale(-1, 1);
  }
  if (rot === 90) {
    ctx.translate(RW, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rot === 180) {
    ctx.translate(RW, RH);
    ctx.rotate(Math.PI);
  } else if (rot === 270) {
    ctx.translate(0, RH);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src.image, 0, 0, W, H);
  try {
    return await toBlob(out);
  } finally {
    out.width = out.height = 0;
  }
}
