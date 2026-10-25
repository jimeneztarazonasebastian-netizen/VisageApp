# Visage

Editor de caras al estilo FaceApp, pensado para el iPhone. Casi todo se procesa en el navegador; solo
la pestaña **IA** envía la foto a Gemini (Google). Se instala como app desde Safari (Compartir → «Añadir a pantalla de inicio»)
y funciona sin conexión a partir de la segunda vez que la abres con conexión (la primera descarga el motor y el modelo de caras).

## Qué hace

- **Looks** de un toque (Natural, Sonrisa, Hollywood, Más joven, Glamour, Modelo, Retrato) con miniaturas de tu propia cara.
- **IA (Gemini):** edad (niño, adolescente, joven, 40, 60, 80), género, barba (corta, completa, candado, bigote, afeitado),
  peinados (largo, corto, flequillo, rizado, ondulado, liso, bob, coleta, moño, afro, rapado, calvo), sonrisa con dientes,
  carcajada, maquillaje, canas, pecas, tatuajes, traje y una edición libre escrita por ti.
- **Retoque:** suavizar piel (conserva la textura), quitar arrugas, unificar tono y acné, iluminar, ojeras, blanquear dientes, brillo de ojos.
- **Expresión:** sonrisa, sorpresa, ceño fruncido, abrir ojos.
- **Forma:** rostro más fino, peso, pómulos, mentón, frente, ojos, nariz, labios, cejas.
- **Gafas y barba:** 6 modelos de gafas (clásicas, redondas, aviador, ojo de gato, de sol, sol aviador) en 5 monturas, y barba incipiente.
- **Maquillaje:** labial, rubor, delineado, pestañas, cejas definidas.
- **Ojos:** color de iris.
- **Cabello:** color (modelo de segmentación, se carga solo al usarlo).
- **Fondo:** desenfoque tipo retrato o color de fondo.
- **Filtros y ajustes:** iluminación (estudio, lateral, hora dorada, dramática), brillo, contraste, saturación, calidez, luces, sombras, nitidez, viñeta.
- **Recortar:** girar, voltear, proporciones (1:1, 4:5, 3:4, 9:16, 16:9) y acercar, centrado en la cara.
- Vista previa en vivo mientras mueves un deslizador; deshacer/rehacer (también las ediciones de IA y los recortes),
  zoom con pellizco, mantener pulsado para ver el antes o comparar con pantalla dividida, guardar a resolución
  completa (hasta 12 MP), compartir a Fotos y guardar una imagen «antes y después».
- Funciona en vertical y en horizontal.
- Con varias personas en la foto, eliges a cuál aplicar los efectos (o a todas).
- La edición en curso se guarda en el teléfono: si iOS cierra la app, al volver aparece «Continuar edición».

## Cómo funciona

| Pieza | Para qué |
| --- | --- |
| MediaPipe Face Landmarker (`public/models/face_landmarker.task`) | 478 puntos de la cara e iris |
| MediaPipe Selfie Multiclass (`public/models/selfie_multiclass.tflite`) | Máscaras de cabello, piel, ropa y fondo |
| `src/lib/engine/` | Motor de edición en JS puro dentro de un Web Worker: deformación (liquify), filtro guiado para la piel, máscaras con suavizado, recoloreado que conserva la textura |
| `public/sw.js` | Modo sin conexión |

`scripts/copy-vision.mjs` copia el runtime WebAssembly de MediaPipe a `public/vendor` (se ejecuta solo antes de `dev` y `build`). `scripts/make-icons.mjs` genera los iconos.

## Privacidad

La edición se hace en el teléfono. La página solo puede conectarse a su propio servidor (cabecera
Content-Security-Policy `connect-src 'self'`): las fotos únicamente salen hacia Google cuando usas la
pestaña IA, a través de `/api/ia`, que además rechaza peticiones de otras webs.

## Desarrollo

```bash
npm install
npm run dev
```

## Despliegue en Vercel

Importa el repositorio en Vercel y añade en **Settings → Environment Variables**:

| Variable | Para qué |
| --- | --- |
| `GEMINI_API_KEY` | Llave de Google AI Studio para la pestaña IA (obligatoria para la IA; lo demás funciona sin ella) |
| `APP_PASSWORD` | Recomendada: contraseña que la app pide antes de usar la IA, para que nadie más gaste tu cuota si encuentra la URL |
| `GEMINI_IMAGE_MODEL` | Opcional: modelo a usar (por defecto `gemini-nano-banana-2.1`, con respaldo en `gemini-3.1-flash-image` y `gemini-2.5-flash-image`) |

Después de añadirlas, vuelve a desplegar (Deployments → Redeploy).

Cada edición con IA cuesta del orden de US$0,04–0,10. Para las ediciones de cara (edad, género, barba, peinado,
sonrisa…) la app envía solo un recorte de la cabeza y funde el resultado en la foto original, que conserva su
resolución; una nueva opción del mismo grupo sustituye a la anterior y Deshacer también quita la IA.
