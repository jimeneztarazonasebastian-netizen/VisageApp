# Rostro

Editor de caras al estilo FaceApp, pensado para el iPhone. Todo se procesa en el navegador: las fotos
nunca salen del teléfono. Se instala como app desde Safari (Compartir → «Añadir a pantalla de inicio»)
y funciona sin conexión después de la primera carga.

## Qué hace

- **Looks** de un toque (Natural, Sonrisa, Hollywood, Más joven, Glamour, Modelo, Retrato) con miniaturas de tu propia cara.
- **Retoque:** suavizar piel (conserva la textura), unificar tono, iluminar, ojeras, blanquear dientes, brillo de ojos.
- **Sonrisa:** más o menos sonrisa (deforma comisuras, mejillas y párpados).
- **Forma:** rostro más fino, pómulos, mentón, frente, ojos, nariz, labios, cejas.
- **Maquillaje:** labial, rubor, delineado, pestañas, cejas definidas.
- **Ojos:** color de iris.
- **Cabello:** color (modelo de segmentación, se carga solo al usarlo).
- **Fondo:** desenfoque tipo retrato o color de fondo.
- **Filtros y ajustes:** brillo, contraste, saturación, calidez, luces, sombras, nitidez, viñeta.
- Deshacer/rehacer, zoom con pellizco, mantener pulsado para ver el original, guardar a resolución completa (hasta 12 MP) y compartir a Fotos.

## Cómo funciona

| Pieza | Para qué |
| --- | --- |
| MediaPipe Face Landmarker (`public/models/face_landmarker.task`) | 478 puntos de la cara e iris |
| MediaPipe Selfie Multiclass (`public/models/selfie_multiclass.tflite`) | Máscaras de cabello, piel, ropa y fondo |
| `src/lib/engine/` | Motor de edición en JS puro dentro de un Web Worker: deformación (liquify), filtro guiado para la piel, máscaras con suavizado, recoloreado que conserva la textura |
| `public/sw.js` | Modo sin conexión |

`scripts/copy-vision.mjs` copia el runtime WebAssembly de MediaPipe a `public/vendor` (se ejecuta solo antes de `dev` y `build`). `scripts/make-icons.mjs` genera los iconos.

## Desarrollo

```bash
npm install
npm run dev
```

## Despliegue en Vercel

Importa el repositorio en Vercel; no necesita variables de entorno ni configuración extra.

## Límites

La edad, el cambio de género y la sonrisa con dientes nuevos de FaceApp necesitan IA generativa,
que no corre bien en el navegador de un iPhone. Aquí la sonrisa y la forma se hacen deformando la foto.
