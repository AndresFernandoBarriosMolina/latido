import { query } from '../config/db.js';

// ============================================================================
//  Guard de acceso a contenido premium.
//
//  PRINCIPIO: el contenido real NUNCA llega al cliente no autorizado.
//  - Visitante / no suscriptor  -> solo recibe `blurred_preview_key`
//    (una imagen YA degradada en el servidor; quitar el blur de CSS en
//    dev-tools no revela nada porque el original no se envió).
//  - Suscriptor activo          -> recibe URL firmada de corta vida del original.
//  Esto cierra el vector de "desbloquear desde funciones de desarrollador".
// ============================================================================

export async function hasActiveSubscription(userId, modelId) {
  if (!userId) return false;
  const { rows } = await query(
    `SELECT 1 FROM subscriptions
      WHERE subscriber_id = $1 AND model_id = $2
        AND status = 'active' AND current_period_end > now()
      LIMIT 1`,
    [userId, modelId]
  );
  return rows.length > 0;
}

export async function hasUnlockedPpv(userId, mediaId) {
  if (!userId) return false;
  const { rows } = await query(
    `SELECT 1 FROM messages
      WHERE media_id = $1 AND $2 = ANY(unlocked_by) LIMIT 1`,
    [mediaId, userId]
  );
  return rows.length > 0;
}

// Determina qué versión de cada media puede ver el solicitante
export async function resolveMediaAccess(req, media) {
  const userId = req.user?.id || null;
  const isOwnerOrStaff =
    userId === media.model_id || ['admin', 'moderator'].includes(req.user?.role);

  if (media.visibility === 'public' || isOwnerOrStaff) return { level: 'full' };

  if (media.visibility === 'subscribers') {
    return (await hasActiveSubscription(userId, media.model_id))
      ? { level: 'full' }
      : { level: 'preview' };
  }
  if (media.visibility === 'ppv') {
    return (await hasUnlockedPpv(userId, media.id))
      ? { level: 'full' }
      : { level: 'preview' };
  }
  return { level: 'preview' };
}

// Middleware para rutas que entregan media: bloquea si no hay acceso
export function gateMedia(getMedia) {
  return async (req, res, next) => {
    const media = await getMedia(req);
    if (!media) return res.status(404).json({ error: 'not_found' });
    const access = await resolveMediaAccess(req, media);
    if (access.level !== 'full') {
      return res.status(402).json({ error: 'subscription_required', preview: media.blurred_preview_key });
    }
    req.media = media;
    next();
  };
}
