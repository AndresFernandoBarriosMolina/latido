import { Router } from 'express';
import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { requireModel } from '../middleware/rbac.js';
import { config } from '../config/index.js';
import { query } from '../config/db.js';
import { giftCatalog } from '../services/gifts.service.js';
import { viewerCountry, isCountryBlocked } from '../services/geo.service.js';
import { publicUrl, signedReadUrl, BUCKET_MEDIA } from '../services/upload.service.js';

// ============================================================================
//  Transmisión en vivo 1-a-muchos con LiveKit (SFU).
//  El backend emite tokens de acceso firmados (JWT con el secreto de LiveKit)
//  que autorizan a un participante a unirse a una sala con permisos concretos:
//   - MODELO (broadcaster): puede publicar (canPublish) su cámara/micrófono.
//   - ESPECTADOR (viewer):  solo puede suscribirse (ver/oír), no publicar.
//  El video nunca pasa por nuestra API: va navegador ↔ LiveKit.
// ============================================================================
const router = Router();

function makeToken({ identity, room, canPublish }) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity, ttl: '3h' });
  at.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true, canPublishData: true });
  return at.toJwt();   // async en el SDK v2
}

// La MODELO obtiene token para transmitir su propia sala (live_<suUserId>).
router.post('/broadcast', authenticate, requireModel, async (req, res, next) => {
  try {
    if (!config.livekit.apiKey || !config.livekit.apiSecret) return res.status(503).json({ error: 'live_not_configured' });
    if (req.user.role !== 'admin') {
      const mp = (await query(`SELECT kyc_status FROM model_profiles WHERE user_id=$1`, [req.user.id])).rows[0];
      if (!mp || mp.kyc_status !== 'approved') return res.status(403).json({ error: 'kyc_required' });
    }
    const room = `live_${req.user.id}`;
    const token = await makeToken({ identity: req.user.id, room, canPublish: true });
    await query(`UPDATE model_profiles SET is_live=true WHERE user_id=$1`, [req.user.id]);
    res.json({ url: config.livekit.url, token, room });
  } catch (e) { next(e); }
});

// Un ESPECTADOR obtiene token para ver la sala en vivo de una modelo.
router.post('/watch', authenticate, async (req, res, next) => {
  try {
    if (!config.livekit.apiKey) return res.status(503).json({ error: 'live_not_configured' });
    const { modelId } = z.object({ modelId: z.string().uuid() }).parse(req.body);
    const mp = (await query(`SELECT is_live, blocked_countries FROM model_profiles WHERE user_id=$1 AND published=true`, [modelId])).rows[0];
    if (!mp) return res.status(404).json({ error: 'model_not_found' });
    // Geo-bloqueo: invisible para el país del espectador.
    if (isCountryBlocked(await viewerCountry(req), mp.blocked_countries || [])) return res.status(404).json({ error: 'model_not_found' });
    if (!mp.is_live) return res.status(409).json({ error: 'not_live' });
    const room = `live_${modelId}`;
    const token = await makeToken({ identity: req.user.id, room, canPublish: false });
    res.json({ url: config.livekit.url, token, room });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' });
    next(e);
  }
});

// La MODELO finaliza su transmisión.
router.post('/stop', authenticate, requireModel, async (req, res, next) => {
  try { await query(`UPDATE model_profiles SET is_live=false WHERE user_id=$1`, [req.user.id]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// Lista de modelos actualmente en vivo (para el descubrimiento). Con foto de
// tarjeta (avatar → si no, foto pública de vitrina) y geo-bloqueo por país.
router.get('/now', optionalAuth, async (req, res, next) => {
  try {
    const country = await viewerCountry(req);
    const params = [];
    let geo = '';
    if (country) { params.push(country); geo = ` AND NOT (COALESCE(mp.blocked_countries,'{}') @> ARRAY[$${params.length}]::text[])`; }
    const { rows } = await query(
      `SELECT mp.user_id, mp.handle, p.display_name, p.avatar_key,
              (SELECT COALESCE(m2.thumbnail_key, m2.original_key) FROM media_assets m2
                 WHERE m2.model_id = mp.user_id AND m2.type='photo' AND m2.visibility='public'
                   AND m2.status='published'
                 ORDER BY m2.published_at DESC NULLS LAST LIMIT 1) AS showcase_key
         FROM model_profiles mp LEFT JOIN profiles p ON p.user_id=mp.user_id
        WHERE mp.is_live=true AND mp.published=true${geo} ORDER BY mp.kyc_approved_at DESC LIMIT 50`,
      params
    );
    const items = await Promise.all(rows.map(async (r) => ({
      ...r,
      photoUrl: r.avatar_key ? publicUrl(r.avatar_key)
        : (r.showcase_key ? await signedReadUrl(r.showcase_key, BUCKET_MEDIA, 600).catch(() => null) : null),
    })));
    res.json({ items });
  } catch (e) { next(e); }
});

// Catálogo de regalos (para la barra de regalos en vivo).
router.get('/gifts', async (_req, res, next) => {
  try { res.json({ items: await giftCatalog() }); } catch (e) { next(e); }
});

export default router;
