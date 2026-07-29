import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireModel } from '../middleware/rbac.js';
import {
  signedUploadUrl, signedReadUrl, publicUrl, uniqueKey, extFromMime,
  assertOwnedKey, assertSafeKey,
  BUCKET_MEDIA, BUCKET_PUBLIC,
} from '../services/upload.service.js';
import { generateImagePreview } from '../services/preview.service.js';
import { config } from '../config/index.js';

const router = Router();
router.use(authenticate);
router.use(requireModel);   // permite rol 'model' y 'admin' (definido en rbac.js)

// Compuerta legal: solo se permite PUBLICAR contenido si la modelo tiene KYC
// aprobado (prueba de edad/identidad) y firmó el consentimiento de publicación
// vigente (titularidad del contenido, todas las personas 18+ — tipo 18 USC 2257
// y Ley 1581). Esto protege legalmente a la plataforma. Los admin quedan exentos.
async function assertPublishingAllowed(req) {
  if (req.user.role === 'admin') return;
  const { rows } = await query(
    `SELECT mp.kyc_status,
            (SELECT 1 FROM content_consents cc
              WHERE cc.model_id=$1 AND cc.doc_version=$2 LIMIT 1) AS consent
       FROM model_profiles mp WHERE mp.user_id=$1`,
    [req.user.id, config.security.contentConsentVersion]
  );
  const mp = rows[0];
  if (!mp || mp.kyc_status !== 'approved')
    throw Object.assign(new Error('kyc_required'), { status: 403 });
  if (!mp.consent)
    throw Object.assign(new Error('content_consent_required'), { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// GANANCIAS / ESTADO FINANCIERO
// ─────────────────────────────────────────────────────────────────────────────
router.get('/earnings', async (req, res, next) => {
  try {
    const { rows: monthly } = await query(
      `SELECT date_trunc('month', created_at)::date AS month,
              SUM(CASE WHEN kind='gift_in'     THEN cop_delta ELSE 0 END) AS gifts,
              SUM(CASE WHEN kind='ppv_in'      THEN cop_delta ELSE 0 END) AS ppv,
              SUM(CASE WHEN kind='subscription' THEN cop_delta ELSE 0 END) AS subs,
              SUM(CASE WHEN cop_delta > 0 THEN cop_delta ELSE 0 END) AS total
         FROM wallet_ledger
        WHERE user_id=$1 AND cop_delta > 0
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      [req.user.id]
    );
    const { rows: wallet } = await query(
      `SELECT earnings_cop FROM wallets WHERE user_id=$1`,
      [req.user.id]
    );
    res.json({
      balance:   Number(wallet[0]?.earnings_cop || 0),
      monthly,
    });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ESTADÍSTICAS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(DISTINCT s.id) FILTER (WHERE s.status='active') AS active_subs,
         COUNT(DISTINCT a.id) FILTER (WHERE a.type='photo' AND a.status != 'removed') AS photos,
         COUNT(DISTINCT a.id) FILTER (WHERE a.type='video' AND a.status != 'removed') AS videos,
         COALESCE(mp.rating_avg, 0) AS rating,
         mp.rating_count
         FROM model_profiles mp
         LEFT JOIN subscriptions s  ON s.model_id = mp.user_id
         LEFT JOIN media_assets  a  ON a.model_id  = mp.user_id
        WHERE mp.user_id = $1
        GROUP BY mp.user_id, mp.rating_avg, mp.rating_count`,
      [req.user.id]
    );
    res.json(rows[0] || { active_subs: 0, photos: 0, videos: 0, rating: 0, rating_count: 0 });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GESTIÓN DE CONTENIDO
// ─────────────────────────────────────────────────────────────────────────────
router.get('/content', async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(50, Number(req.query.limit || 20));
    const type  = req.query.type;    // photo | video
    const album = req.query.album;

    const conds = [`ma.model_id = $1`, `ma.status != 'removed'`];
    const vals  = [req.user.id];
    let i = 2;
    if (type && type !== 'all') { conds.push(`ma.type = $${i++}::media_type`); vals.push(type); }
    if (album)                  { conds.push(`ma.album_id = $${i++}`);         vals.push(album); }

    const { rows } = await query(
      `SELECT ma.id, ma.type AS media_type, ma.caption, ma.visibility, ma.status,
              ma.blurred_preview_key, ma.original_key, ma.album_id,
              ma.duration_sec, ma.likes_count, ma.views_count, ma.created_at,
              al.name AS album_name
         FROM media_assets ma
         LEFT JOIN media_albums al ON al.id = ma.album_id
        WHERE ${conds.join(' AND ')}
        ORDER BY ma.created_at DESC
        LIMIT $${i} OFFSET $${i+1}`,
      [...vals, limit, (page - 1) * limit]
    );
    const { rows: cnt } = await query(
      `SELECT COUNT(*) AS total FROM media_assets WHERE model_id=$1 AND status != 'removed'`,
      [req.user.id]
    );
    // La creadora ve su PROPIO contenido: se firma una URL del original de corta
    // vida (foto = imagen; video = reproducible) y se adjunta la del preview.
    const items = await Promise.all(rows.map(async (r) => ({
      ...r,
      url: r.original_key ? await signedReadUrl(r.original_key, BUCKET_MEDIA, 300) : null,
      previewUrl: publicUrl(r.blurred_preview_key),
    })));
    res.json({ items, total: Number(cnt[0].total), page, limit });
  } catch (e) { next(e); }
});

// URL presignada para subida directa desde el navegador
router.post('/content/upload-url', async (req, res, next) => {
  try {
    const { contentType } = z.object({ contentType: z.string() }).parse(req.body);
    const allowed = [
      'image/jpeg','image/png','image/webp',
      'video/mp4','video/webm','video/quicktime',
    ];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'invalid_content_type' });
    const isVideo   = contentType.startsWith('video/');
    const maxBytes  = isVideo ? 500_000_000 : 20_000_000;
    const ext       = extFromMime(contentType);
    const key       = uniqueKey(`content/${req.user.id}`, ext);
    const previewKey= uniqueKey(`previews/${req.user.id}`, 'jpg');
    const uploadUrl = await signedUploadUrl({ bucket: BUCKET_MEDIA, key, contentType, maxBytes });
    res.json({ uploadUrl, key, previewKey, isVideo });
  } catch (e) { next(e); }
});

// Registrar en DB el asset ya subido a MinIO
const publishSchema = z.object({
  mediaType:         z.enum(['photo','video']),
  originalKey:       z.string().min(5),
  // Para video: clave de un fotograma (póster) subido por el cliente, del cual
  // el SERVIDOR genera el preview borroso. Para foto se ignora (usa el original).
  posterKey:         z.string().min(5).optional(),
  caption:           z.string().max(500).optional(),
  visibility:        z.enum(['public','subscribers','ppv']).optional(),
  status:            z.enum(['published','draft']).optional(),
  albumId:           z.string().uuid().optional(),
  durationSec:       z.number().positive().int().optional(),
  ppvPrice:          z.number().int().min(1).optional(),
});

router.post('/content', async (req, res, next) => {
  try {
    const d = publishSchema.parse(req.body);
    // Solo se publica con KYC aprobado + consentimiento de publicación vigente.
    await assertPublishingAllowed(req);
    // Anti-IDOR: las claves enviadas por el cliente DEBEN pertenecer al prefijo
    // del propio usuario; no se puede referenciar contenido de otra persona.
    assertOwnedKey(d.originalKey, 'content', req.user.id);
    if (d.posterKey) assertOwnedKey(d.posterKey, 'content', req.user.id);

    // PREVIEW BORROSO generado en el SERVIDOR (autoritativo). El no-suscriptor
    // jamás recibe el original: solo esta imagen ya degradada e irrecuperable.
    //  - foto  → se degrada el propio original.
    //  - video → se degrada el póster (fotograma) que subió el cliente.
    let blurredPreviewKey = null;
    const previewSource = d.mediaType === 'video' ? d.posterKey : d.originalKey;
    if (previewSource) {
      try {
        blurredPreviewKey = await generateImagePreview({ sourceKey: previewSource, userId: req.user.id });
      } catch (e) {
        req.log?.warn?.({ err: e?.message }, 'preview_generation_failed');
        // Falla segura: sin preview, el no-suscriptor verá un hueco, NUNCA el original.
      }
    }
    const { rows } = await query(
      `INSERT INTO media_assets
         (model_id, type, original_key, blurred_preview_key,
          caption, visibility, status, album_id, duration_sec, ppv_price_diamonds,
          published_at)
       VALUES ($1,$2::media_type,$3,$4,$5,$6::visibility_type,$7::media_status,$8,$9,$10,
          CASE WHEN $7 = 'published' THEN now() ELSE NULL END)
       RETURNING id, created_at`,
      [
        req.user.id, d.mediaType, d.originalKey,
        blurredPreviewKey, d.caption || null,
        d.visibility || 'subscribers',
        d.status || 'published',
        d.albumId || null, d.durationSec || null, d.ppvPrice || null,
      ]
    );
    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  } catch (e) { next(e); }
});

// Actualizar metadatos
router.patch('/content/:id', async (req, res, next) => {
  try {
    const d = z.object({
      caption:    z.string().max(500).optional(),
      visibility: z.enum(['public','subscribers','ppv']).optional(),
      status:     z.enum(['published','draft']).optional(),
      albumId:    z.string().uuid().nullable().optional(),
    }).parse(req.body);

    const sets = [], vals = [];
    let i = 1;
    if (d.caption    !== undefined) { sets.push(`caption=$${i++}`);                      vals.push(d.caption); }
    if (d.visibility !== undefined) { sets.push(`visibility=$${i++}::visibility_type`);  vals.push(d.visibility); }
    if (d.status     !== undefined) { sets.push(`status=$${i++}::media_status`);         vals.push(d.status); }
    if (d.albumId    !== undefined) { sets.push(`album_id=$${i++}`);                     vals.push(d.albumId); }
    if (!sets.length) return res.json({ ok: true });

    vals.push(req.params.id, req.user.id);
    const { rowCount } = await query(
      `UPDATE media_assets SET ${sets.join(',')} WHERE id=$${i++} AND model_id=$${i} AND status != 'removed'`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Soft-delete (status = removed)
router.delete('/content/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE media_assets SET status='removed'
        WHERE id=$1 AND model_id=$2 AND status != 'removed'`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// URL firmada para previsualizar contenido propio (privado)
router.get('/content/:id/url', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT original_key FROM media_assets WHERE id=$1 AND model_id=$2 AND status != 'removed'`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const url = await signedReadUrl(rows[0].original_key, BUCKET_MEDIA, 120);
    res.json({ url });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSENTIMIENTO DE PUBLICACIÓN (cumplimiento 2257 / Ley 1581)
// ─────────────────────────────────────────────────────────────────────────────
// Estado del consentimiento vigente y del KYC (para que el cliente sepa si puede publicar).
router.get('/content-consent', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT mp.kyc_status,
              (SELECT signed_at FROM content_consents cc
                WHERE cc.model_id=$1 AND cc.doc_version=$2
                ORDER BY signed_at DESC LIMIT 1) AS signed_at
         FROM model_profiles mp WHERE mp.user_id=$1`,
      [req.user.id, config.security.contentConsentVersion]
    );
    const mp = rows[0] || {};
    res.json({
      docVersion: config.security.contentConsentVersion,
      kycStatus: mp.kyc_status || 'not_started',
      consentSignedAt: mp.signed_at || null,
      canPublish: mp.kyc_status === 'approved' && !!mp.signed_at,
    });
  } catch (e) { next(e); }
});

// Firmar el consentimiento de publicación vigente. Registra IP y versión.
router.post('/content-consent', async (req, res, next) => {
  try {
    const { accept } = z.object({ accept: z.literal(true) }).parse(req.body);
    void accept;
    await query(
      `INSERT INTO content_consents (model_id, doc_version, ip)
       VALUES ($1,$2,$3)
       ON CONFLICT (model_id, doc_version) DO NOTHING`,
      [req.user.id, config.security.contentConsentVersion, req.ip]
    );
    res.status(201).json({ ok: true, docVersion: config.security.contentConsentVersion });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ÁLBUMES
// ─────────────────────────────────────────────────────────────────────────────
router.get('/albums', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT al.id, al.name, al.description, al.cover_key, al.is_public, al.sort_order,
              COUNT(ma.id)::int AS item_count
         FROM media_albums al
         LEFT JOIN media_assets ma ON ma.album_id = al.id AND ma.status != 'removed'
        WHERE al.model_id = $1
        GROUP BY al.id ORDER BY al.sort_order, al.created_at DESC`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const albumSchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  coverKey:    z.string().max(300).optional(),
  isPublic:    z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
});

router.post('/albums', async (req, res, next) => {
  try {
    const d = albumSchema.parse(req.body);
    if (d.coverKey) assertSafeKey(d.coverKey);
    const { rows } = await query(
      `INSERT INTO media_albums (model_id, name, description, cover_key, is_public, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [req.user.id, d.name, d.description||null, d.coverKey||null, d.isPublic !== false, d.sortOrder||0]
    );
    res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
  } catch (e) { next(e); }
});

router.patch('/albums/:id', async (req, res, next) => {
  try {
    const d = albumSchema.partial().parse(req.body);
    const sets = [], vals = [];
    let i = 1;
    if (d.name        !== undefined) { sets.push(`name=$${i++}`);        vals.push(d.name); }
    if (d.description !== undefined) { sets.push(`description=$${i++}`); vals.push(d.description); }
    if (d.coverKey    !== undefined) { sets.push(`cover_key=$${i++}`);   vals.push(d.coverKey); }
    if (d.isPublic    !== undefined) { sets.push(`is_public=$${i++}`);   vals.push(d.isPublic); }
    if (d.sortOrder   !== undefined) { sets.push(`sort_order=$${i++}`);  vals.push(d.sortOrder); }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id, req.user.id);
    const { rowCount } = await query(
      `UPDATE media_albums SET ${sets.join(',')} WHERE id=$${i++} AND model_id=$${i}`,
      vals
    );
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/albums/:id', async (req, res, next) => {
  try {
    await withTx(async (c) => {
      await c.query(`UPDATE media_assets SET album_id=NULL WHERE album_id=$1 AND model_id=$2`,
        [req.params.id, req.user.id]);
      const { rowCount } = await c.query(
        `DELETE FROM media_albums WHERE id=$1 AND model_id=$2`,
        [req.params.id, req.user.id]
      );
      if (!rowCount) throw Object.assign(new Error('not_found'), { status: 404 });
    });
    res.json({ ok: true });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
});

export default router;
