// Generative edits with Gemini's image model. The key lives only here (GEMINI_API_KEY in Vercel);
// the phone sends the photo and which edit it wants, and gets the edited photo back.
import { timingSafeEqual } from "node:crypto";
import { AI_PRESETS, fullPrompt } from "@/lib/ai-presets";

export const maxDuration = 120;

const API = "https://generativelanguage.googleapis.com/v1beta";
const RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9"];

type Body = { image?: string; mime?: string; preset?: string; custom?: string; width?: number; height?: number };
type Found = { data: string; mime: string };

const reply = (status: number, error: string) => Response.json({ error }, { status });

function checkPassword(req: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const got = Buffer.from(req.headers.get("x-app-password") ?? "");
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

function closestRatio(w: number, h: number) {
  const r = w / h;
  let best = RATIOS[0], diff = Infinity;
  for (const s of RATIOS) {
    const [a, b] = s.split(":").map(Number);
    const d = Math.abs(Math.log(r / (a / b)));
    if (d < diff) {
      diff = d;
      best = s;
    }
  }
  return best;
}

/** Finds the first image in any of the API's response shapes (Interactions or generateContent). */
function findImage(node: unknown): Found | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findImage(n);
      if (f) return f;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  const inline = (o.inlineData ?? o.inline_data) as Record<string, unknown> | undefined;
  if (inline && typeof inline.data === "string") return { data: inline.data, mime: String(inline.mimeType ?? inline.mime_type ?? "image/png") };
  if (o.type === "image" && typeof o.data === "string") return { data: o.data, mime: String(o.mime_type ?? o.mimeType ?? "image/png") };
  for (const v of Object.values(o)) {
    const f = findImage(v);
    if (f) return f;
  }
  return null;
}

function findText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(findText).filter(Boolean).join(" ");
  const o = node as Record<string, unknown>;
  const own = typeof o.text === "string" ? o.text : "";
  const reason = typeof o.finishReason === "string" && o.finishReason !== "STOP" ? o.finishReason : "";
  const block = typeof (o.promptFeedback as Record<string, unknown> | undefined)?.blockReason === "string" ? String((o.promptFeedback as Record<string, unknown>).blockReason) : "";
  return [own, reason, block, ...Object.entries(o).filter(([k]) => !["text", "data", "input", "contents", "usage"].includes(k)).map(([, v]) => findText(v))].filter(Boolean).join(" ").trim();
}

type Attempt = { ok: true; image: Found } | { ok: false; status: number; message: string; refused?: boolean };

async function call(url: string, key: string, body: unknown): Promise<Attempt> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Errors come as { error } from generateContent and as [{ error }] from the Interactions API.
    const err = (Array.isArray(json) ? json[0] : json) as { error?: { message?: string } } | null;
    const message = err?.error?.message ?? res.statusText;
    return { ok: false, status: res.status, message };
  }
  const image = findImage(json);
  if (image) return { ok: true, image };
  return { ok: false, status: 422, message: findText(json).slice(0, 300) || "El modelo no devolvió ninguna imagen.", refused: true };
}

function interactions(model: string, prompt: string, img: Found, ratio: string) {
  return {
    model,
    input: [
      { type: "text", text: prompt },
      { type: "image", mime_type: img.mime, data: img.data },
    ],
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: ratio, image_size: "2K" },
  };
}

function generateContent(prompt: string, img: Found, ratio: string) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio } },
  };
}

/** A missing model or an unsupported field means "try the next way", anything else is final. */
const tryNext = (a: Attempt) => !a.ok && !a.refused && (a.status === 404 || (a.status === 400 && /model|not found|unknown|unsupported|invalid json payload|response_format|image_size/i.test(a.message)));

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, "Falta la llave: añade GEMINI_API_KEY en Vercel (Settings → Environment Variables) y vuelve a desplegar.");
  if (!checkPassword(req)) return reply(401, "Contraseña incorrecta.");

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.image || body.image.length > 25_000_000) return reply(400, "Falta la foto o es demasiado grande.");
  const instruction = body.preset ? AI_PRESETS[body.preset]?.prompt : body.custom?.trim().slice(0, 800);
  if (!instruction) return reply(400, "Edición desconocida.");

  const prompt = fullPrompt(instruction);
  const img: Found = { data: body.image, mime: body.mime === "image/png" ? "image/png" : "image/jpeg" };
  const ratio = closestRatio(body.width || 3, body.height || 4);
  const models = [...new Set([process.env.GEMINI_IMAGE_MODEL, "gemini-nano-banana-2.1", "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter(Boolean) as string[])];

  let last: Attempt | null = null;
  for (const model of models) {
    for (const attempt of [
      () => call(`${API}/interactions`, key, interactions(model, prompt, img, ratio)),
      () => call(`${API}/models/${model}:generateContent`, key, generateContent(prompt, img, ratio)),
    ]) {
      last = await attempt();
      if (last.ok) return Response.json({ image: last.image.data, mime: last.image.mime, model });
      if (!tryNext(last)) break;
    }
    if (last && !last.ok && !tryNext(last)) break;
  }

  if (!last || last.ok) return reply(502, "No se pudo generar la imagen.");
  if (last.refused) return reply(422, `Gemini no hizo esta edición. ${last.message}`.trim());
  if (last.status === 400 && /api key/i.test(last.message)) return reply(502, "La llave de Gemini no es válida.");
  if (last.status === 401 || last.status === 403) return reply(502, "La llave de Gemini no es válida o no tiene permiso para este modelo.");
  if (last.status === 429) return reply(429, "Se alcanzó el límite de uso de Gemini. Espera un momento o revisa tu cuota.");
  return reply(502, `Error de Gemini (${last.status}): ${last.message}`);
}
