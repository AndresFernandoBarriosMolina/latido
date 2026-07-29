import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { query } from '../config/db.js';
import { signedReadUrl, BUCKET_MEDIA } from './upload.service.js';

// URL firmada de corta vida para el ORIGINAL (solo tras pasar contentGuard).
// Firmada con el endpoint público (vía upload.service) → alcanzable por el navegador.
export async function signedOriginalUrl(key) {
  return signedReadUrl(key, BUCKET_MEDIA, config.s3.signedTtl);
}

// Marca de agua forense: identificador único por (usuario, media) para rastrear filtraciones
export function watermarkId(userId, mediaId) {
  return crypto
    .createHmac('sha256', config.security.watermarkSalt)
    .update(`${userId}:${mediaId}`)
    .digest('hex')
    .slice(0, 16);
}

// Registra cada acceso al contenido (auditoría anti-fuga)
export async function logMediaAccess({ mediaId, userId, ip, ua }) {
  const wid = watermarkId(userId, mediaId);
  await query(
    `INSERT INTO media_access_log (media_id, user_id, watermark_id, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [mediaId, userId, wid, ip, ua]
  );
  return wid;
}
