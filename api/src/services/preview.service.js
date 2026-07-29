import sharp from 'sharp';
import crypto from 'node:crypto';
import {
  getObjectBuffer, putObjectBuffer, uniqueKey,
  BUCKET_MEDIA, BUCKET_PUBLIC,
} from './upload.service.js';

// ============================================================================
//  Generación de PREVIEW BORROSO en el SERVIDOR (protección de contenido).
//
//  PRINCIPIO DE SEGURIDAD: el archivo original NUNCA se entrega a un no-suscriptor.
//  Lo que ve el no-suscriptor es una imagen DISTINTA, ya degradada en el servidor:
//   - reducida a ~24px (se destruye el detalle de forma irreversible),
//   - reescalada con desenfoque (queda borrosa, no recuperable),
//   - con marca de agua "Suscríbete" incrustada en los píxeles.
//  No es blur de CSS: quitar estilos en el navegador no revela nada, porque los
//  píxeles del original jamás salieron del servidor.
// ============================================================================

const TINY = 24;        // ancho intermedio: destruye el detalle
const OUT_W = 480;      // ancho final del preview
// ASCII puro: el contenedor alpine no trae fuentes con glifos acentuados (saldrían
// como cajitas). Mantener sin tildes ni símbolos para que la marca renderice limpia.
const WATERMARK = 'SUSCRIBETE - LATIDO';

// Genera el SVG de marca de agua repetida (incrustada en el JPEG).
function watermarkSvg(width, height) {
  const rows = [];
  const stepY = 90;
  for (let y = 40; y < height; y += stepY) {
    const offset = (y / stepY) % 2 ? 120 : 0;
    for (let x = -40 + offset; x < width; x += 240) {
      rows.push(`<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="20" fill="rgba(255,255,255,0.45)" transform="rotate(-28 ${x} ${y})">${WATERMARK}</text>`);
    }
  }
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="rgba(0,0,0,0.18)"/>
       <g style="font-weight:700">${rows.join('')}</g>
     </svg>`
  );
}

// Degrada una imagen (Buffer) a un preview borroso con marca de agua → Buffer JPEG.
export async function degradeImageBuffer(srcBuffer) {
  // 1) Reducir a TINY px: destruye el detalle de forma irreversible.
  const tiny = await sharp(srcBuffer).rotate().resize(TINY, null, { fit: 'inside' }).toBuffer();
  // 2) Reescalar a tamaño final con desenfoque → borroso liso.
  const meta = await sharp(tiny).metadata();
  const outH = Math.round(OUT_W * ((meta.height || 1) / (meta.width || 1)));
  const base = await sharp(tiny)
    .resize(OUT_W, outH, { fit: 'fill', kernel: 'cubic' })
    .blur(12)
    .modulate({ brightness: 0.92, saturation: 0.9 })
    .toBuffer();
  // 3) Incrustar marca de agua en los píxeles.
  return sharp(base)
    .composite([{ input: watermarkSvg(OUT_W, outH), top: 0, left: 0 }])
    .jpeg({ quality: 40 })
    .toBuffer();
}

// Descarga el original (bucket privado), genera el preview y lo sube al bucket
// público bajo previews/<userId>/. Devuelve la clave del preview.
export async function generateImagePreview({ sourceKey, sourceBucket = BUCKET_MEDIA, userId }) {
  const src = await getObjectBuffer(sourceBucket, sourceKey);
  const preview = await degradeImageBuffer(src);
  const key = uniqueKey(`previews/${userId}`, 'jpg');
  await putObjectBuffer(BUCKET_PUBLIC, key, preview, 'image/jpeg');
  return key;
}

// Identificador opaco para trazabilidad de la generación (no sensible).
export function previewTag() {
  return crypto.randomUUID().slice(0, 8);
}
