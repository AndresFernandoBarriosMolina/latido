import { Router } from 'express';
import { optionalAuth, authenticate } from '../middleware/auth.js';
import { resolveMediaAccess } from '../middleware/contentGuard.js';
import { signedOriginalUrl, logMediaAccess } from '../services/media.service.js';
import { signedReadUrl, publicUrl, BUCKET_MEDIA } from '../services/upload.service.js';
import { query } from '../config/db.js';

const router = Router();

// Lista de contenido de una modelo.
//  - NO suscrito  → thumbUrl = preview YA borroso (bucket público, /cdn). El
//    original jamás se envía; quitar CSS/DOM no revela nada.
//  - Suscrito     → thumbUrl = URL firmada de corta vida del original (nítido).
router.get('/model/:modelId', optionalAuth, async (req, res, next) => {
  try {
    const album = req.query.album;
    const params = [req.params.modelId];
    let where = `model_id=$1 AND status='published'`;
    if (album) { params.push(album); where += ` AND album_id=$${params.length}`; }
    const { rows } = await query(
      `SELECT id, model_id, type, visibility, thumbnail_key, blurred_preview_key,
              original_key, ppv_price_diamonds, caption, album_id
         FROM media_assets
        WHERE ${where}
        ORDER BY published_at DESC NULLS LAST, created_at DESC`,
      params
    );
    const items = await Promise.all(rows.map(async (m) => {
      const access = await resolveMediaAccess(req, m);
      const full = access.level === 'full';
      const thumbUrl = full
        ? await signedReadUrl(m.thumbnail_key || m.original_key, BUCKET_MEDIA, 300)
        : publicUrl(m.blurred_preview_key);  // /cdn → preview degradado en servidor
      return {
        id: m.id,
        type: m.type,
        visibility: m.visibility,
        locked: !full,
        thumbUrl,
        albumId: m.album_id,
        ppvPrice: m.ppv_price_diamonds,
        caption: m.caption,
      };
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

// Álbumes/colecciones PÚBLICOS de una modelo (para mostrar pestañas/secciones).
router.get('/model/:modelId/albums', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT al.id, al.name, al.cover_key,
              COUNT(ma.id)::int AS item_count
         FROM media_albums al
         LEFT JOIN media_assets ma ON ma.album_id = al.id AND ma.status='published'
        WHERE al.model_id=$1 AND al.is_public = true
        GROUP BY al.id
        HAVING COUNT(ma.id) > 0
        ORDER BY al.sort_order, al.created_at DESC`,
      [req.params.modelId]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Entrega de URL firmada del ORIGINAL (solo suscriptores / PPV desbloqueado)
router.get('/media/:id/url', authenticate, async (req, res) => {
  const { rows } = await query(`SELECT * FROM media_assets WHERE id=$1`, [req.params.id]);
  const media = rows[0];
  if (!media) return res.status(404).json({ error: 'not_found' });

  const access = await resolveMediaAccess(req, media);
  if (access.level !== 'full')
    return res.status(402).json({ error: 'subscription_required' });

  const wid = await logMediaAccess({
    mediaId: media.id, userId: req.user.id,
    ip: req.ip, ua: req.headers['user-agent'],
  });
  const url = await signedOriginalUrl(media.type === 'video' ? media.hls_manifest_key : media.original_key);
  res.json({ url, watermarkId: wid, expiresIn: 45 });
});

export default router;
