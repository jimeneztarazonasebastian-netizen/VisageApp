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

async function call(url: string, key: string, body: unknown, signal: AbortSignal): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, status: timedOut ? 504 : 502, message: timedOut ? "timeout" : "network" };
  }
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
    // Don't keep the selfie and its result on Google's side (the Interactions API stores by default).
    store: false,
  };
}

function generateContent(prompt: string, img: Found, ratio: string) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: img.mime, data: img.data } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio } },
  };
}

/** Spanish explanation of why Gemini returned no image (safety blocks come as codes in English). */
function refusalMessage(text: string) {
  if (/RECITATION/.test(text)) return "Gemini no hizo esta edición porque el resultado se parecía demasiado a una imagen existente. Prueba con otra opción.";
  if (/SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(text))
    return "Gemini rechazó esta edición por sus normas de seguridad (pasa a veces con fotos de personas reales). Prueba con otra opción u otra foto.";
  return "Gemini no devolvió ninguna imagen esta vez. Vuelve a intentarlo o prueba con otra opción.";
}

/** A missing model or an unsupported field means "try the next way", anything else is final. */
const tryNext = (a: Attempt) => !a.ok && !a.refused && (a.status === 404 || (a.status === 400 && /model|not found|unknown|unsupported|invalid json payload|response_format|image_size/i.test(a.message)));

/**
 * Only the app itself may call this: a page on another site could otherwise make its visitors'
 * browsers start edits billed to your key. Browsers always send Sec-Fetch-Site / Origin on fetch.
 */
function sameSite(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return [req.headers.get("x-forwarded-host"), req.headers.get("host"), new URL(req.url).host].includes(host);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return reply(415, "Petición no válida.");
  if (!sameSite(req)) return reply(403, "Petición no permitida.");
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

  // Stay under the function's time limit (maxDuration 120 s) whatever happens upstream.
  const deadline = Date.now() + 100_000;
  let last: Attempt | null = null;
  const quota: string[] = [];
  let overloaded = false;
  outer: for (const model of models) {
    for (const attempt of [
      (signal: AbortSignal) => call(`${API}/interactions`, key, interactions(model, prompt, img, ratio), signal),
      (signal: AbortSignal) => call(`${API}/models/${model}:generateContent`, key, generateContent(prompt, img, ratio), signal),
    ]) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) {
        last = { ok: false, status: 504, message: "timeout" };
        break outer;
      }
      // Also stops (and stops being billed) when the phone cancels or goes away.
      last = await attempt(AbortSignal.any([req.signal, AbortSignal.timeout(remaining)]));
      if (last.ok) return Response.json({ image: last.image.data, mime: last.image.mime, model });
      if (req.signal.aborted) return reply(499, "Cancelado.");
      if (!tryNext(last)) break;
    }
    if (!last || last.ok) break;
    // Quotas are per model: when this one has none on the free tier ("limit: 0"), another may.
    // A real rate limit is final, though: hopping to a pricier model would cost more.
    if (last.status === 429) {
      quota.push(`${model}: ${last.message}`);
      if (/free.?tier|limit: ?0/i.test(last.message)) continue;
      break;
    }
    // "The model is overloaded" and other upstream hiccups: the next model may be fine.
    if (last.status === 500 || last.status === 502 || last.status === 503) {
      overloaded = true;
      continue;
    }
    if (!tryNext(last)) break;
  }

  if (!last || last.ok) return reply(502, "No se pudo generar la imagen.");
  if (last.refused) return reply(422, refusalMessage(last.message));
  const freeTier = quota.some((q) => /free.?tier|limit: ?0/i.test(q));
  if (last.status === 400 && /api key/i.test(last.message)) return reply(502, "La llave de Gemini no es válida.");
  if (last.status === 401 || last.status === 403) return reply(502, "La llave de Gemini no es válida o no tiene permiso para este modelo.");
  if (last.status === 504) return reply(504, "La IA tardó demasiado en responder. Vuelve a intentarlo.");
  // The quota explanation wins over whatever the last fallback model said (e.g. "not found").
  if (freeTier || last.status === 429)
    return Response.json(
      {
        error: freeTier
          ? "Tu llave de Gemini está en el plan gratuito y no tiene cuota para generar imágenes. Activa la facturación en Google AI Studio (Billing) y vuelve a intentarlo."
          : "Se alcanzó el límite de uso de Gemini. Espera un minuto o revisa tu cuota en Google AI Studio.",
        details: quota.map((q) => q.slice(0, 400)),
      },
      { status: 429 },
    );
  if (overloaded || last.status >= 500) return reply(503, "Gemini está saturado ahora mismo. Vuelve a intentarlo en un minuto.");
  return reply(502, `Gemini respondió con un error (${last.status}). Vuelve a intentarlo.`);
}
