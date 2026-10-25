// AI edits that only change the head (age, gender, beard, hair, smile…) are generated on a crop
// around it and blended back into the full-resolution photo, so the rest of the picture keeps its
// original pixels and the saved photo keeps its resolution.
import { EXPORT_MAX_PIXELS, drawScaled, toBlob } from "./photo";
import type { Face } from "./vision";

export type Crop = { x: number; y: number; w: number; h: number };

/** A 4:5 box around the head, generous enough for long hair and a beard; in image pixels. */
export function headCrop(face: Face, W: number, H: number): Crop {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of face) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const fw = (x1 - x0) * W, fh = (y1 - y0) * H;
  const cx = ((x0 + x1) / 2) * W, cy = ((y0 + y1) / 2) * H - fh * 0.12;
  let w = Math.max(fw, fh) * 2.3;
  let h = w * 1.25;
  if (w > W) { h *= W / w; w = W; }
  if (h > H) { w *= H / h; h = H; }
  const x = Math.min(Math.max(0, cx - w / 2), W - w);
  const y = Math.min(Math.max(0, cy - h / 2), H - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The crop, scaled so its longest side is at most `maxEdge`, ready to send. */
export function cropCanvas(image: CanvasImageSource, crop: Crop, maxEdge: number) {
  const k = Math.min(1, maxEdge / Math.max(crop.w, crop.h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(crop.w * k));
  c.height = Math.max(1, Math.round(crop.h * k));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  return c;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Puts the AI result back into the photo: scaled into the crop box, its colour matched to the photo
 * along the box border (models drift slightly in tone), and faded out towards the box sides that
 * are inside the picture. Returns the new full-resolution photo as a JPEG.
 */
export async function blendIntoPhoto(image: HTMLImageElement, W: number, H: number, crop: Crop, result: HTMLImageElement): Promise<Blob> {
  const full = drawScaled(image, W, H, Infinity, EXPORT_MAX_PIXELS);
  const k = full.width / W;
  const rx = Math.round(crop.x * k), ry = Math.round(crop.y * k);
  const rw = Math.min(full.width - rx, Math.round(crop.w * k)), rh = Math.min(full.height - ry, Math.round(crop.h * k));
  const fctx = full.getContext("2d", { willReadFrequently: true })!;
  const before = fctx.getImageData(rx, ry, rw, rh);

  // The result, cover-fitted into the box (the model may return a slightly different aspect).
  const patch = document.createElement("canvas");
  patch.width = rw;
  patch.height = rh;
  const pctx = patch.getContext("2d", { willReadFrequently: true })!;
  const s = Math.max(rw / result.naturalWidth, rh / result.naturalHeight);
  const dw = result.naturalWidth * s, dh = result.naturalHeight * s;
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(result, (rw - dw) / 2, (rh - dh) / 2, dw, dh);
  const after = pctx.getImageData(0, 0, rw, rh);

  // Which sides are inside the picture (and so need a soft edge), and how wide the fade is.
  const feather = Math.max(8, Math.min(rw, rh) * 0.14);
  const fadeL = rx > 0, fadeT = ry > 0, fadeR = rx + rw < full.width, fadeB = ry + rh < full.height;
  const alphaAt = (x: number, y: number) =>
    (fadeL ? smooth(x / feather) : 1) * (fadeT ? smooth(y / feather) : 1) * (fadeR ? smooth((rw - 1 - x) / feather) : 1) * (fadeB ? smooth((rh - 1 - y) / feather) : 1);

  // Colour match on the border band, where photo and result should show the same background.
  const sumB = [0, 0, 0], sumA = [0, 0, 0];
  let n = 0;
  const step = Math.max(1, Math.round(Math.min(rw, rh) / 200));
  for (let y = 0; y < rh; y += step)
    for (let x = 0; x < rw; x += step) {
      const a = alphaAt(x, y);
      if (a <= 0 || a >= 0.9) continue;
      const i = (y * rw + x) * 4;
      for (let c = 0; c < 3; c++) {
        sumB[c] += before.data[i + c];
        sumA[c] += after.data[i + c];
      }
      n++;
    }
  const gain = [0, 1, 2].map((c) => (n && sumA[c] > 0 ? Math.min(1.15, Math.max(0.87, sumB[c] / sumA[c])) : 1));

  const d = after.data, b = before.data;
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 4;
      const a = alphaAt(x, y);
      for (let c = 0; c < 3; c++) d[i + c] = b[i + c] + (d[i + c] * gain[c] - b[i + c]) * a;
      d[i + 3] = 255;
    }
  fctx.putImageData(after, rx, ry);
  patch.width = patch.height = 0;
  try {
    return await toBlob(full);
  } finally {
    full.width = full.height = 0;
  }
}

export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen de la IA"));
    };
    img.src = url;
  });
}
