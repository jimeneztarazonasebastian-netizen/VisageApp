// Face landmarks and person segmentation with MediaPipe, entirely in the browser. The engine and the
// models are served from our own domain (/vendor/mediapipe, /models) and loaded on first use.
import type { FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";

export type Point = { x: number; y: number };
/** 478 landmarks in normalised coordinates (0–1 of the image width/height). */
export type Face = Point[];

export type Mask = { width: number; height: number; data: Float32Array };
/** Confidence masks from the multiclass selfie model, all at the same resolution. */
export type Segmentation = { background: Mask; hair: Mask; bodySkin: Mask; faceSkin: Mask; clothes: Mask };

const WASM = "/vendor/mediapipe";
const lib = () => import("@mediapipe/tasks-vision");

let fileset: ReturnType<typeof makeFileset> | undefined;
let landmarker: Promise<FaceLandmarker> | undefined;
let segmenter: Promise<ImageSegmenter> | undefined;

function makeFileset() {
  return lib().then((m) => m.FilesetResolver.forVisionTasks(WASM));
}

function getLandmarker() {
  landmarker ??= (async () => {
    const m = await lib();
    return m.FaceLandmarker.createFromOptions(await (fileset ??= makeFileset()), {
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
      runningMode: "IMAGE",
      numFaces: 6,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
    });
  })();
  landmarker.catch(() => (landmarker = undefined));
  return landmarker;
}

function getSegmenter() {
  segmenter ??= (async () => {
    const m = await lib();
    return m.ImageSegmenter.createFromOptions(await (fileset ??= makeFileset()), {
      baseOptions: { modelAssetPath: "/models/selfie_multiclass.tflite", delegate: "CPU" },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  })();
  segmenter.catch(() => (segmenter = undefined));
  return segmenter;
}

/** Starts downloading the face model so the first photo is analysed sooner. */
export function preloadFaces() {
  getLandmarker().catch(() => {});
}

export async function detectFaces(image: HTMLCanvasElement): Promise<Face[]> {
  const result = (await getLandmarker()).detect(image);
  return result.faceLandmarks.filter((f) => f.length >= 468).map((f) => f.map((p) => ({ x: p.x, y: p.y })));
}

/**
 * The model sees a 256×256 view, so small faces in a wide shot lose detail. When there's a face we
 * also segment a crop around the heads and paste it over the full-image result, which keeps hair
 * edges sharp without giving up the background mask for the rest of the picture.
 */
export async function segment(image: HTMLCanvasElement, faces: Face[]): Promise<Segmentation> {
  const seg = await getSegmenter();
  const W = image.width;
  const H = image.height;
  const full = run(seg, image, W, H);

  if (faces.length) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const f of faces)
      for (const p of f) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    const fw = (x1 - x0) * W;
    const fh = (y1 - y0) * H;
    const side = Math.max(fw, fh) * 2.6;
    const cx = ((x0 + x1) / 2) * W;
    const cy = ((y0 + y1) / 2) * H - fh * 0.15;
    const rx = Math.max(0, Math.round(cx - side / 2));
    const ry = Math.max(0, Math.round(cy - side / 2));
    const rw = Math.min(W, Math.round(cx + side / 2)) - rx;
    const rh = Math.min(H, Math.round(cy + side / 2)) - ry;
    // Only worth it when the crop is noticeably smaller than the photo.
    if (rw * rh < W * H * 0.6 && rw > 32 && rh > 32) {
      const crop = document.createElement("canvas");
      crop.width = rw;
      crop.height = rh;
      crop.getContext("2d")!.drawImage(image, rx, ry, rw, rh, 0, 0, rw, rh);
      const part = run(seg, crop, rw, rh);
      const feather = Math.max(4, Math.round(Math.min(rw, rh) * 0.08));
      for (const key of Object.keys(full) as (keyof Segmentation)[]) {
        const dst = full[key].data;
        const src = part[key].data;
        for (let y = 0; y < rh; y++) {
          const wy = Math.min(1, y / feather, (rh - 1 - y) / feather);
          for (let x = 0; x < rw; x++) {
            const w = Math.max(0, Math.min(wy, x / feather, (rw - 1 - x) / feather));
            const i = (ry + y) * W + rx + x;
            dst[i] += (src[y * rw + x] - dst[i]) * w;
          }
        }
      }
    }
  }
  return full;
}

function run(seg: ImageSegmenter, image: HTMLCanvasElement, W: number, H: number): Segmentation {
  const result = seg.segment(image);
  try {
    const masks = result.confidenceMasks ?? [];
    const get = (i: number): Mask => {
      const m = masks[i];
      if (!m) return { width: W, height: H, data: new Float32Array(W * H) };
      return resize({ width: m.width, height: m.height, data: new Float32Array(m.getAsFloat32Array()) }, W, H);
    };
    // Category order of selfie_multiclass_256x256.
    return { background: get(0), hair: get(1), bodySkin: get(2), faceSkin: get(3), clothes: get(4) };
  } finally {
    result.close();
  }
}

/** Bilinear resize of a mask to exactly W×H. */
export function resize(m: Mask, W: number, H: number): Mask {
  if (m.width === W && m.height === H) return m;
  const out = new Float32Array(W * H);
  const sx = m.width / W;
  const sy = m.height / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(m.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(m.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(m.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(m.width - 1, x0 + 1);
      const tx = fx - x0;
      const a = m.data[y0 * m.width + x0] + (m.data[y0 * m.width + x1] - m.data[y0 * m.width + x0]) * tx;
      const b = m.data[y1 * m.width + x0] + (m.data[y1 * m.width + x1] - m.data[y1 * m.width + x0]) * tx;
      out[y * W + x] = a + (b - a) * ty;
    }
  }
  return { width: W, height: H, data: out };
}
