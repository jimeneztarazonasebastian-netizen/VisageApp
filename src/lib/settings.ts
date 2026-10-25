// Every adjustment the editor offers, grouped the way the bottom bar shows them.

export type Settings = Record<string, number | string>;

/** `when`: only shown while that other setting has a value. */
export type SliderSpec = { kind: "slider"; id: string; label: string; min: number; max: number; when?: string };
export type ColorSpec = { kind: "color"; id: string; label: string; strength: string; colors: { name: string; hex: string }[]; when?: string };
export type ChoiceSpec = { kind: "choice"; id: string; label: string; options: { id: string; name: string }[]; when?: string; showLabel?: boolean };
export type Control = SliderSpec | ColorSpec | ChoiceSpec;

export type Category = { id: string; label: string; icon: string; controls: Control[]; needsSegmentation?: boolean };

const slider = (id: string, label: string, min = 0, max = 100): SliderSpec => ({ kind: "slider", id, label, min, max });

export const LIP_COLORS = [
  { name: "Rojo", hex: "#b3122e" },
  { name: "Cereza", hex: "#8e1538" },
  { name: "Rosa", hex: "#d4587a" },
  { name: "Nude", hex: "#b9746a" },
  { name: "Coral", hex: "#e0604f" },
  { name: "Vino", hex: "#5e1224" },
  { name: "Fucsia", hex: "#c2185b" },
  { name: "Malva", hex: "#9c5a7c" },
];

export const BLUSH_COLORS = [
  { name: "Rosa", hex: "#e8768f" },
  { name: "Durazno", hex: "#f09474" },
  { name: "Coral", hex: "#e8665c" },
  { name: "Malva", hex: "#c97a9a" },
];

export const EYE_COLORS = [
  { name: "Azul", hex: "#3d7fc4" },
  { name: "Celeste", hex: "#6fb3d9" },
  { name: "Verde", hex: "#4f9a5a" },
  { name: "Avellana", hex: "#8a6b3a" },
  { name: "Miel", hex: "#b88a3c" },
  { name: "Gris", hex: "#8a96a3" },
  { name: "Violeta", hex: "#7d5bb8" },
  { name: "Marrón", hex: "#5a3a22" },
];

export const HAIR_COLORS = [
  { name: "Negro", hex: "#1a1514" },
  { name: "Castaño", hex: "#5b3a24" },
  { name: "Chocolate", hex: "#3d2316" },
  { name: "Rubio", hex: "#d6b277" },
  { name: "Platino", hex: "#e7e1d6" },
  { name: "Cobrizo", hex: "#a8482a" },
  { name: "Rojo", hex: "#8f1d22" },
  { name: "Rosa", hex: "#e48bb1" },
  { name: "Azul", hex: "#3058a8" },
  { name: "Violeta", hex: "#6b3fa0" },
  { name: "Gris", hex: "#9e9e9e" },
];

export const BACKGROUND_COLORS = [
  { name: "Blanco", hex: "#ffffff" },
  { name: "Estudio", hex: "#bfc3c7" },
  { name: "Negro", hex: "#111111" },
  { name: "Crema", hex: "#efe6d8" },
  { name: "Celeste", hex: "#a9cfe8" },
  { name: "Rosa", hex: "#f1c6d3" },
];

export const FILTERS = [
  { id: "", name: "Ninguno" },
  { id: "vivo", name: "Vivo" },
  { id: "calido", name: "Cálido" },
  { id: "frio", name: "Frío" },
  { id: "dorado", name: "Dorado" },
  { id: "vintage", name: "Vintage" },
  { id: "drama", name: "Drama" },
  { id: "bn", name: "B/N" },
  { id: "noir", name: "Noir" },
];

export const GLASSES = [
  { id: "", name: "Ninguna" },
  { id: "clasicas", name: "Clásicas" },
  { id: "redondas", name: "Redondas" },
  { id: "aviador", name: "Aviador" },
  { id: "gato", name: "Ojo de gato" },
  { id: "sol", name: "De sol" },
  { id: "solAviador", name: "Sol aviador" },
];

export const FRAME_COLORS = [
  { id: "", name: "Negra" },
  { id: "carey", name: "Carey" },
  { id: "dorada", name: "Dorada" },
  { id: "plateada", name: "Plateada" },
  { id: "transparente", name: "Transparente" },
];

export const LIGHTS = [
  { id: "", name: "Natural" },
  { id: "estudio", name: "Estudio" },
  { id: "lateral", name: "Lateral" },
  { id: "dorada", name: "Hora dorada" },
  { id: "dramatica", name: "Dramática" },
];

export const CATEGORIES: Category[] = [
  {
    id: "retoque",
    label: "Retoque",
    icon: "sparkles",
    controls: [
      slider("suavizar", "Suavizar piel"),
      slider("arrugas", "Quitar arrugas"),
      slider("manchas", "Unificar tono y acné"),
      slider("iluminar", "Iluminar rostro"),
      slider("ojeras", "Ojeras"),
      slider("dientes", "Blanquear dientes"),
      slider("brilloOjos", "Brillo de ojos"),
    ],
  },
  {
    id: "expresion",
    label: "Expresión",
    icon: "smile",
    controls: [slider("sonrisa", "Sonrisa", -100, 100), slider("sorpresa", "Sorpresa"), slider("enfado", "Ceño fruncido"), slider("abrirOjos", "Abrir ojos", -100, 100)],
  },
  {
    id: "forma",
    label: "Forma",
    icon: "face",
    controls: [
      slider("rostro", "Rostro más fino", -100, 100),
      slider("peso", "Peso", -100, 100),
      slider("pomulos", "Pómulos", -100, 100),
      slider("menton", "Mentón", -100, 100),
      slider("frente", "Frente más pequeña", -100, 100),
      slider("ojos", "Ojos más grandes", -100, 100),
      slider("nariz", "Nariz más fina", -100, 100),
      slider("labios", "Labios más gruesos", -100, 100),
      slider("cejas", "Subir cejas", -100, 100),
    ],
  },
  {
    id: "maquillaje",
    label: "Maquillaje",
    icon: "lips",
    controls: [
      { kind: "color", id: "labialColor", label: "Labial", strength: "labial", colors: LIP_COLORS },
      { kind: "color", id: "ruborColor", label: "Rubor", strength: "rubor", colors: BLUSH_COLORS },
      slider("delineado", "Delineado"),
      slider("pestanas", "Pestañas"),
      slider("cejasDef", "Definir cejas"),
    ],
  },
  {
    id: "accesorios",
    label: "Gafas y barba",
    icon: "glasses",
    controls: [
      { kind: "choice", id: "gafas", label: "Gafas", options: GLASSES, showLabel: true },
      { kind: "choice", id: "gafasColor", label: "Montura", options: FRAME_COLORS, when: "gafas", showLabel: true },
      slider("barba", "Barba incipiente"),
    ],
  },
  { id: "ojos", label: "Ojos", icon: "eye", controls: [{ kind: "color", id: "ojosColor", label: "Color de ojos", strength: "ojosIntensidad", colors: EYE_COLORS }] },
  {
    id: "cabello",
    label: "Cabello",
    icon: "hair",
    needsSegmentation: true,
    controls: [{ kind: "color", id: "cabelloColor", label: "Color de cabello", strength: "cabelloIntensidad", colors: HAIR_COLORS }],
  },
  {
    id: "fondo",
    label: "Fondo",
    icon: "background",
    needsSegmentation: true,
    controls: [slider("desenfoque", "Desenfocar fondo"), { kind: "color", id: "fondoColor", label: "Cambiar fondo", strength: "fondoIntensidad", colors: BACKGROUND_COLORS }],
  },
  { id: "filtros", label: "Filtros", icon: "filter", controls: [{ kind: "choice", id: "filtro", label: "Filtro", options: FILTERS }, slider("filtroIntensidad", "Intensidad")] },
  {
    id: "ajustes",
    label: "Ajustes",
    icon: "sliders",
    controls: [
      { kind: "choice", id: "luz", label: "Iluminación", options: LIGHTS, showLabel: true },
      { ...slider("luzIntensidad", "Intensidad de la luz"), when: "luz" },
      slider("brillo", "Brillo", -100, 100),
      slider("contraste", "Contraste", -100, 100),
      slider("saturacion", "Saturación", -100, 100),
      slider("calidez", "Calidez", -100, 100),
      slider("luces", "Luces", -100, 100),
      slider("sombras", "Sombras", -100, 100),
      slider("nitidez", "Nitidez"),
      slider("vineta", "Viñeta"),
    ],
  },
];

export const DEFAULTS: Settings = {
  labial: 60,
  rubor: 45,
  ojosIntensidad: 70,
  cabelloIntensidad: 75,
  fondoIntensidad: 100,
  filtroIntensidad: 80,
  labialColor: "",
  ruborColor: "",
  ojosColor: "",
  cabelloColor: "",
  fondoColor: "",
  filtro: "",
  gafas: "",
  gafasColor: "",
  luz: "",
  luzIntensidad: 60,
  // The look currently applied (one of LOOKS) and how strongly.
  look: "",
  lookIntensidad: 100,
  // Which face gets the face effects when there are several: 0 = the largest, -1 = all of them.
  cara: 0,
};

/** The neutral value of a control: what its reset button goes back to. */
export const defaultOf = (id: string): number | string => DEFAULTS[id] ?? 0;

export const num = (s: Settings, id: string) => (typeof s[id] === "number" ? (s[id] as number) : 0);
export const str = (s: Settings, id: string) => (typeof s[id] === "string" ? (s[id] as string) : "");

/** One-tap looks, like FaceApp's: each one is a set of the sliders above. */
export const LOOKS: { id: string; name: string; settings: Settings }[] = [
  { id: "natural", name: "Natural", settings: { suavizar: 35, manchas: 25, iluminar: 15, ojeras: 35, dientes: 30, brilloOjos: 20 } },
  { id: "sonrisa", name: "Sonrisa", settings: { sonrisa: 70, suavizar: 25, ojeras: 25, dientes: 40 } },
  { id: "hollywood", name: "Hollywood", settings: { sonrisa: 55, arrugas: 40, suavizar: 55, manchas: 40, iluminar: 25, ojeras: 50, dientes: 70, brilloOjos: 35, ojos: 18, rostro: 25, nariz: 15, nitidez: 20 } },
  { id: "joven", name: "Más joven", settings: { suavizar: 80, arrugas: 90, manchas: 60, iluminar: 30, ojeras: 70, ojos: 22, rostro: 15, menton: -10, labios: 15, brilloOjos: 30 } },
  {
    id: "glam",
    name: "Glamour",
    settings: { suavizar: 60, manchas: 45, iluminar: 20, ojeras: 50, labialColor: "#b3122e", labial: 65, ruborColor: "#e8768f", rubor: 40, delineado: 60, pestanas: 55, cejasDef: 35, ojos: 12, rostro: 20, nariz: 12 },
  },
  { id: "modelo", name: "Modelo", settings: { rostro: 35, pomulos: 30, menton: 10, ojos: 15, nariz: 25, labios: 20, suavizar: 50, manchas: 40, contraste: 12, nitidez: 25 } },
  { id: "estudio", name: "Estudio", settings: { luz: "estudio", luzIntensidad: 70, suavizar: 40, arrugas: 30, ojeras: 40, contraste: 8, nitidez: 20 } },
  { id: "intelectual", name: "Intelectual", settings: { gafas: "clasicas", suavizar: 25, ojeras: 30 } },
  { id: "verano", name: "Verano", settings: { gafas: "sol", luz: "dorada", luzIntensidad: 60, calidez: 25, saturacion: 10 } },
  { id: "retrato", name: "Retrato", settings: { suavizar: 30, ojeras: 30, desenfoque: 55, vineta: 25, contraste: 10 } },
];

/** A look's values at an intensity (0–100): numbers scale, choices and colours stay as they are. */
function lookValues(id: string, intensity: number): Settings {
  const look = LOOKS.find((l) => l.id === id);
  if (!look) return {};
  const out: Settings = {};
  for (const [k, v] of Object.entries(look.settings)) out[k] = typeof v === "number" ? Math.round((v * intensity) / 100) : v;
  return out;
}

/**
 * Switches to another look (or none, with id ""). Only what the previous look set — and you haven't
 * changed since — is taken back to neutral, so glasses, lipstick, hair colour or background you
 * chose yourself survive a change of look.
 */
export function applyLook(current: Settings, id: string, intensity: number): Settings {
  const next: Settings = { ...current };
  const before = lookValues(str(current, "look"), typeof current.lookIntensidad === "number" ? current.lookIntensidad : 100);
  for (const [k, v] of Object.entries(before)) if (next[k] === v) next[k] = defaultOf(k);
  Object.assign(next, lookValues(id, intensity));
  next.look = LOOKS.some((l) => l.id === id) ? id : "";
  next.lookIntensidad = intensity;
  return next;
}
