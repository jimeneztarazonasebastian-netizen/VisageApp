// Generative edits (sent to Gemini). Labels are shown in the app; prompts are only used on the server.

export type AiPreset = { id: string; name: string; prompt: string };
export type AiGroup = { id: string; label: string; presets: AiPreset[] };

const age = (id: string, name: string, years: string, extra: string): AiPreset => ({
  id,
  name,
  prompt: `Make the person look ${years}. ${extra} Keep it the same individual: same identity, bone structure proportions, eye colour, ethnicity, hairstyle (adapted naturally to the age), expression, pose, clothing, background and lighting.`,
});

export const AI_GROUPS: AiGroup[] = [
  {
    id: "edad",
    label: "Edad",
    presets: [
      age("nino", "Niño/a", "like a child of about 7 years old", "Child proportions: rounder face, bigger eyes relative to the face, smaller nose, smooth skin."),
      age("teen", "Adolescente", "about 16 years old", "Youthful skin and softer features."),
      age("joven", "Joven", "about 10 years younger than now, in their twenties", "Smoother, firmer skin, fewer lines, fuller cheeks, fewer grey hairs."),
      age("adulto", "40 años", "about 40 years old", "Subtle expression lines, mature features."),
      age("mayor", "60 años", "about 60 years old", "Realistic ageing: wrinkles around eyes and forehead, nasolabial folds, some sagging, grey hair."),
      age("anciano", "80 años", "about 80 years old", "Strong realistic ageing: deep wrinkles, thinner and white or grey hair, age spots, sagging skin."),
    ],
  },
  {
    id: "genero",
    label: "Género",
    presets: [
      {
        id: "mujer",
        name: "Mujer",
        prompt:
          "Transform the person into a woman, as if they had been born female: feminine facial structure and features, no facial hair, a natural feminine hairstyle of similar colour. Keep the same identity resemblance (like their sister), age, ethnicity, skin tone, eye colour, expression, pose, clothing style, background and lighting.",
      },
      {
        id: "hombre",
        name: "Hombre",
        prompt:
          "Transform the person into a man, as if they had been born male: masculine facial structure and features, a natural masculine short hairstyle of similar colour, a light natural beard shadow. Keep the same identity resemblance (like their brother), age, ethnicity, skin tone, eye colour, expression, pose, clothing style, background and lighting.",
      },
    ],
  },
  {
    id: "barba",
    label: "Barba",
    presets: [
      { id: "barbaCorta", name: "Corta", prompt: "Give the person a short, well-groomed beard (a few millimetres long) with a natural hairline, matching their hair colour." },
      { id: "barbaCompleta", name: "Completa", prompt: "Give the person a full, thick, well-groomed beard and moustache matching their hair colour, with realistic individual hairs." },
      { id: "candado", name: "Candado", prompt: "Give the person a goatee (circle beard: moustache connected to a chin beard), neatly trimmed, matching their hair colour." },
      { id: "bigote", name: "Bigote", prompt: "Give the person a natural, well-groomed moustache only (no beard), matching their hair colour." },
      { id: "afeitado", name: "Sin barba", prompt: "Remove all facial hair: the person is clean-shaven with natural skin where the beard and moustache were." },
    ],
  },
  {
    id: "peinado",
    label: "Peinado",
    presets: [
      { id: "largo", name: "Largo", prompt: "Change the hairstyle to long, healthy hair falling past the shoulders, same hair colour." },
      { id: "corto", name: "Corto", prompt: "Change the hairstyle to a short, modern haircut, same hair colour." },
      { id: "flequillo", name: "Flequillo", prompt: "Give the person straight bangs (fringe) across the forehead, keeping the rest of the hairstyle and the hair colour." },
      { id: "rizado", name: "Rizado", prompt: "Change the hair to voluminous natural curls, same length and colour." },
      { id: "ondulado", name: "Ondulado", prompt: "Change the hair to soft natural waves, same length and colour." },
      { id: "liso", name: "Liso", prompt: "Change the hair to sleek straight hair, same length and colour." },
      { id: "bob", name: "Bob", prompt: "Change the hairstyle to a chin-length bob, same hair colour." },
      { id: "coleta", name: "Coleta", prompt: "Style the hair into a neat ponytail, same hair colour." },
      { id: "mono", name: "Moño", prompt: "Style the hair into an elegant bun, same hair colour." },
      { id: "afro", name: "Afro", prompt: "Change the hairstyle to a natural rounded afro, same hair colour." },
      { id: "rapado", name: "Rapado", prompt: "Change the hairstyle to a buzz cut (very short, clipped hair), same hair colour." },
      { id: "calvo", name: "Calvo", prompt: "Make the person completely bald with a natural scalp, keeping the eyebrows." },
    ],
  },
  {
    id: "sonrisa",
    label: "Sonrisa",
    presets: [
      { id: "dientes", name: "Con dientes", prompt: "Make the person smile naturally showing their upper teeth, with the eyes smiling too (Duchenne smile)." },
      { id: "suave", name: "Suave", prompt: "Give the person a gentle closed-mouth smile." },
      { id: "carcajada", name: "Carcajada", prompt: "Make the person laugh happily with an open mouth showing teeth, eyes slightly squinting." },
      { id: "seria", name: "Seria", prompt: "Give the person a neutral, relaxed serious expression with a closed mouth." },
    ],
  },
  {
    id: "estilo",
    label: "Estilo",
    presets: [
      { id: "maquillajeIA", name: "Maquillaje", prompt: "Apply flattering, professional natural-glam makeup: even foundation, soft contour, defined brows, subtle eyeshadow, mascara and a rosy lip." },
      { id: "pelirrojo", name: "Pelirrojo", prompt: "Change the hair colour to a natural copper red, keeping hairstyle and texture." },
      { id: "canas", name: "Canas", prompt: "Make the hair naturally silver-grey, keeping hairstyle and texture." },
      { id: "pecas", name: "Pecas", prompt: "Add natural light freckles across the nose and cheeks." },
      { id: "tatuaje", name: "Tatuajes", prompt: "Add tasteful realistic tattoos on the visible arms and neck (not on the face)." },
      { id: "traje", name: "Traje", prompt: "Dress the person in a well-fitted dark suit with a white shirt, keeping the pose." },
    ],
  },
];

export const AI_PRESETS: Record<string, AiPreset> = Object.fromEntries(AI_GROUPS.flatMap((g) => g.presets.map((p) => [p.id, p])));

/** Wrapped around every edit so the result stays a photo of the same person. */
export function fullPrompt(instruction: string) {
  return [
    "Edit this photograph.",
    instruction,
    "Change only what is asked. The result must be a photorealistic photo of the same person, with natural skin texture and the same camera, framing, background, lighting and image quality. No artistic filters, no text, no borders.",
  ].join(" ");
}
