// Decoding a photo and producing the sizes the editor works with.

export const PREVIEW_EDGE = 1600;
/** iOS Safari refuses canvases above ~16.7 MP; 12 MP keeps full iPhone resolution with headroom. */
export const EXPORT_MAX_PIXELS = 12_200_000;

export type Photo = {
  name: string;
  image: HTMLImageElement;
  width: number;
  height: number;
  preview: HTMLCanvasElement;
};

export async function loadPhoto(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("decode"));
      image.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      /heic|heif/i.test(file.type + file.name)
        ? "Este navegador no abre fotos HEIC. En el iPhone ábrela desde Safari, o elige una JPG/PNG."
        : "No pude abrir esa imagen. Prueba con una foto JPG, PNG o HEIC.",
    );
  }
  // Browsers apply the EXIF orientation when drawing, so these are the upright dimensions.
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  return { name: file.name.replace(/\.[^.]+$/, "") || "foto", image, width, height, preview: drawScaled(image, width, height, PREVIEW_EDGE) };
}

export function drawScaled(image: CanvasImageSource, width: number, height: number, maxEdge: number, maxPixels = Infinity) {
  let k = Math.min(1, maxEdge / Math.max(width, height));
  if (width * height * k * k > maxPixels) k = Math.sqrt(maxPixels / (width * height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function pixels(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
}

export function exportCanvas(photo: Photo) {
  return drawScaled(photo.image, photo.width, photo.height, Infinity, EXPORT_MAX_PIXELS);
}

export function toBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo crear la imagen"))), type, quality));
}
