import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireStaff } from '../middleware/rbac.js';
import { query, withTx } from '../config/db.js';
import { moderationReadMessages } from '../services/messages.service.js';
import { applyDecision } from '../services/kyc.service.js';

const router = Router();
router.use(authenticate);

/* ================================================================
   DASHBOARD — KPIs financieros
================================================================ */
router.get('/dashboard', requireAdmin, async (_req, res, next) => {
  try {
    const [users, models, subs, revenue, payouts, pendingKyc, openReports] = await Promise.all([
      query(`SELECT count(*)::int n FROM users WHERE role='user'`),
      query(`SELECT count(*)::int n FROM users WHERE role='model'`),
      query(`SELECT count(*)::int n FROM subscriptions WHERE status='active'`),
      query(`SELECT COALESCE(sum(amount_cop),0)::bigint t FROM payments WHERE status='approved' AND paid_at >= date_trunc('month', now())`),
      query(`SELECT COALESCE(sum(amount_cop),0)::bigint t FROM payouts WHERE status='paid' AND paid_at >= date_trunc('month', now())`),
      query(`SELECT count(*)::int n FROM kyc_verifications WHERE status IN ('submitted','in_review')`),
      query(`SELECT count(*)::int n FROM reports WHERE status='open'`),
    ]);
    res.json({
      users: users.rows[0].n,
      models: models.rows[0].n,
      activeSubscriptions: subs.rows[0].n,
      monthRevenueCop: Number(revenue.rows[0].t),
      monthPayoutsCop: Number(payouts.rows[0].t),
      pendingKyc: pendingKyc.rows[0].n,
      openReports: openReports.rows[0].n,
    });
  } catch (e) { next(e); }
});

/* ================================================================
   GESTIÓN DE USUARIOS
================================================================ */
const userListQuery = z.object({
  q:      z.string().max(80).optional(),
  role:   z.enum(['user','model','moderator','admin']).optional(),
  status: z.enum(['pending','active','suspended','banned','deleted']).optional(),
  limit:  z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

router.get('/users', requireStaff, async (req, res, next) => {
  try {
    const p = userListQuery.parse(req.query);
    const conds = ['1=1'], vals = [];
    let i = 1;
    if (p.q) {
      conds.push(`(u.email ILIKE $${i} OR p.display_name ILIKE $${i} OR u.phone ILIKE $${i})`);
      vals.push('%' + p.q + '%'); i++;
    }
    if (p.role)   { conds.push(`u.role=$${i++}`);   vals.push(p.role); }
    if (p.status) { conds.push(`u.status=$${i++}`); vals.push(p.status); }

    vals.push(p.limit, p.offset);
    const { rows } = await query(
      `SELECT u.id, u.role, u.status, u.email, u.phone, u.email_verified, u.created_at, u.last_seen_at,
              p.display_name, p.city, p.is_verified,
              (SELECT count(*)::int FROM subscriptions s WHERE s.subscriber_id=u.id AND s.status='active') AS active_subs
         FROM users u LEFT JOIN profiles p ON p.user_id=u.id
        WHERE ${conds.join(' AND ')}
        ORDER BY u.created_at DESC
        LIMIT $${i} OFFSET $${i+1}`,
      vals
    );
    const total = (await query(`SELECT count(*)::int n FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE ${conds.join(' AND ')}`, vals.slice(0,-2))).rows[0].n;
    res.json({ items: rows, total, limit: p.limit, offset: p.offset });
  } catch (e) { next(e); }
});

router.get('/users/:id', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.role, u.status, u.email, u.phone,
              u.email_verified, u.phone_verified, u.birthdate,
              u.age_verified, u.data_consent_at, u.tos_version,
              u.created_at, u.last_seen_at,
              p.display_name, p.bio, p.gender, p.interests, p.city, p.country, p.is_verified,
              w.diamonds, w.earnings_cop,
              (SELECT json_agg(row_to_json(k)) FROM kyc_verifications k WHERE k.user_id=u.id) AS kyc,
              (SELECT count(*)::int FROM subscriptions s WHERE s.subscriber_id=u.id AND s.status='active') AS active_subs,
              (SELECT COALESCE(sum(amount_cop),0)::bigint FROM payments WHERE user_id=u.id AND status='approved') AS total_paid_cop
         FROM users u
         LEFT JOIN profiles p ON p.user_id=u.id
         LEFT JOIN wallets  w ON w.user_id=u.id
        WHERE u.id=$1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/users/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status, reason } = req.body || {};
    const valid = ['pending','active','suspended','banned','deleted'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'invalid_status' });

    await withTx(async (c) => {
      await c.query(`UPDATE users SET status=$1 WHERE id=$2`, [status, req.params.id]);
      await c.query(
        `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta)
         VALUES ($1,'user.status_change','users',$2,$3,$4)`,
        [req.user.id, req.params.id, req.ip, JSON.stringify({ status, reason })]
      );
      if (['suspended','banned'].includes(status)) {
        await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.params.id]);
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/users/:id/role', requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body || {};
    const valid = ['user','model','moderator'];
    if (!valid.includes(role)) return res.status(400).json({ error: 'invalid_role' });
    await withTx(async (c) => {
      await c.query(`UPDATE users SET role=$1 WHERE id=$2`, [role, req.params.id]);
      await c.query(
        `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'user.role_change','users',$2,$3,$4)`,
        [req.user.id, req.params.id, req.ip, JSON.stringify({ role })]
      );
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Crédito MANUAL de diamantes a la billetera (soporte, cortesías, pruebas).
// Queda en wallet_ledger (kind='adjustment') y en audit_log.
const creditSchema = z.object({
  diamonds: z.number().int().min(1).max(10000000),
  memo: z.string().max(200).optional(),
});
router.post('/users/:id/credit', requireAdmin, async (req, res, next) => {
  try {
    const { diamonds, memo } = creditSchema.parse(req.body);
    const uid = req.params.id;
    const exists = (await query(`SELECT 1 FROM users WHERE id=$1`, [uid])).rows[0];
    if (!exists) return res.status(404).json({ error: 'user_not_found' });
    const bal = await withTx(async (c) => {
      const w = (await c.query(
        `INSERT INTO wallets (user_id, diamonds) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET diamonds = wallets.diamonds + $2, updated_at=now()
         RETURNING diamonds`, [uid, diamonds])).rows[0];
      await c.query(
        `INSERT INTO wallet_ledger (user_id, kind, diamonds_delta, balance_diamonds, ref_type, memo)
         VALUES ($1,'adjustment',$2,$3,'admin_credit',$4)`,
        [uid, diamonds, w.diamonds, memo || `Crédito manual +${diamonds} 💎`]);
      await c.query(
        `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta)
         VALUES ($1,'wallet.credit','users',$2,$3,$4)`,
        [req.user.id, uid, req.ip, JSON.stringify({ diamonds, memo: memo || null })]);
      return w.diamonds;
    });
    res.json({ ok: true, diamonds: Number(bal) });
  } catch (e) { if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' }); next(e); }
});

// Enviar notificación a usuario
router.post('/users/:id/notify', requireStaff, async (req, res, next) => {
  try {
    const { type, title, body, data } = req.body || {};
    if (!type || !title) return res.status(400).json({ error: 'invalid' });
    await query(
      `INSERT INTO notifications (user_id,type,title,body,data) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, type, title, body || null, data ? JSON.stringify(data) : null]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================================================================
   COLA KYC — verificación de modelos
================================================================ */
router.get('/kyc/queue', requireStaff, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT k.id, k.user_id, k.status, k.full_name, k.document_type,
              k.liveness_passed, k.face_match_score, k.submitted_at, k.review_notes,
              p.display_name, u.email
         FROM kyc_verifications k
         JOIN users u ON u.id=k.user_id
         LEFT JOIN profiles p ON p.user_id=k.user_id
        WHERE k.status IN ('submitted','in_review')
        ORDER BY k.submitted_at ASC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.patch('/kyc/:id/status', requireStaff, async (req, res, next) => {
  try {
    await query(
      `UPDATE kyc_verifications SET status='in_review', reviewer_id=$1, reviewed_at=now() WHERE id=$2`,
      [req.user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/kyc/:id/decision', requireStaff, async (req, res, next) => {
  try {
    const { decision, notes } = req.body || {};
    if (!['approve','reject'].includes(decision)) return res.status(400).json({ error: 'invalid_decision' });
    const k = (await query(`SELECT user_id FROM kyc_verifications WHERE id=$1`, [req.params.id])).rows[0];
    if (!k) return res.status(404).json({ error: 'not_found' });
    // Misma lógica/efectos que la decisión automática (auditoría consistente).
    await applyDecision({ kycId: req.params.id, userId: k.user_id, decision, reviewerId: req.user.id, notes: notes || null, source: 'manual', ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================================================================
   MODERACIÓN / REPORTES
================================================================ */
router.get('/reports', requireStaff, async (req, res, next) => {
  try {
    const { status = 'open', limit = 50, offset = 0 } = req.query;
    const { rows } = await query(
      `SELECT r.*, p.display_name AS reporter_name
         FROM reports r LEFT JOIN profiles p ON p.user_id=r.reporter_id
        WHERE r.status=$1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [status, Number(limit), Number(offset)]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post('/reports/:id/resolve', requireStaff, async (req, res, next) => {
  try {
    const { resolution, action } = req.body || {};
    await withTx(async (c) => {
      await c.query(
        `UPDATE reports SET status='resolved', handled_by=$1, resolution=$2, resolved_at=now() WHERE id=$3`,
        [req.user.id, resolution || null, req.params.id]
      );
      if (action) {
        const r = (await c.query(`SELECT * FROM reports WHERE id=$1`, [req.params.id])).rows[0];
        await c.query(
          `INSERT INTO moderation_actions (actor_id,target_user_id,target_media_id,action,reason)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.user.id, r.target_user_id || null, r.target_media_id || null, action, resolution || null]
        );
        if (['suspend','ban'].includes(action) && r.target_user_id) {
          const newStatus = action === 'ban' ? 'banned' : 'suspended';
          await c.query(`UPDATE users SET status=$1 WHERE id=$2`, [newStatus, r.target_user_id]);
          await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [r.target_user_id]);
        }
      }
      await c.query(
        `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'report.resolve','reports',$2,$3,$4)`,
        [req.user.id, req.params.id, req.ip, JSON.stringify({ resolution, action })]
      );
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================================================================
   MODERACIÓN DE CONVERSACIONES (acceso legal / reportes)
   Cada lectura descifra mensajes y queda registrada en audit_log.
   Justificación obligatoria para trazabilidad legal (Ley 1581 / 2257).
================================================================ */
// Conversaciones de un usuario (sin contenido; solo metadatos).
router.get('/users/:id/conversations', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.user_a, c.user_b, c.last_message_at,
              (SELECT count(*)::int FROM messages m WHERE m.conversation_id=c.id) AS message_count
         FROM conversations c
        WHERE c.user_a=$1 OR c.user_b=$1
        ORDER BY c.last_message_at DESC NULLS LAST LIMIT 100`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Lectura descifrada de una conversación — SOLO con justificación, auditada.
router.get('/conversations/:id/messages', requireStaff, async (req, res, next) => {
  try {
    const reason = (req.query.reason || '').toString().trim();
    if (reason.length < 5)
      return res.status(400).json({ error: 'reason_required', hint: 'Indique el motivo legal/moderación (?reason=...)' });

    const conv = (await query(`SELECT id FROM conversations WHERE id=$1`, [req.params.id])).rows[0];
    if (!conv) return res.status(404).json({ error: 'not_found' });

    const items = await moderationReadMessages(req.params.id);
    await query(
      `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta)
       VALUES ($1,'conversation.read','conversations',$2,$3,$4)`,
      [req.user.id, req.params.id, req.ip, JSON.stringify({ reason, count: items.length })]
    );
    res.json({ items, audited: true });
  } catch (e) { next(e); }
});

/* ================================================================
   PAYOUTS — retiros de modelos
================================================================ */
router.get('/payouts', requireAdmin, async (req, res, next) => {
  try {
    const { status = 'requested', limit = 50, offset = 0 } = req.query;
    const { rows } = await query(
      `SELECT po.*, p.display_name AS model_name, u.email AS model_email
         FROM payouts po
         JOIN users u ON u.id=po.model_id
         LEFT JOIN profiles p ON p.user_id=po.model_id
        WHERE po.status=$1 ORDER BY po.requested_at ASC LIMIT $2 OFFSET $3`,
      [status, Number(limit), Number(offset)]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post('/payouts/:id/approve', requireAdmin, async (req, res, next) => {
  try {
    const { notes } = req.body || {};
    await withTx(async (c) => {
      const po = (await c.query(`SELECT * FROM payouts WHERE id=$1 AND status='requested'`, [req.params.id])).rows[0];
      if (!po) return res.status(404).json({ error: 'not_found' });

      await c.query(
        `UPDATE payouts SET status='approved', approved_by=$1, notes=$2 WHERE id=$3`,
        [req.user.id, notes || null, req.params.id]
      );
      await c.query(
        `INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'payout.approve','payouts',$2,$3,$4)`,
        [req.user.id, req.params.id, req.ip, JSON.stringify({ notes })]
      );
      res.json({ ok: true });
    });
  } catch (e) { next(e); }
});

/* ================================================================
   CONFIGURACIÓN DEL SISTEMA
================================================================ */
router.get('/settings', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key,value,description,updated_at FROM system_settings ORDER BY key`);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.put('/settings/:key', requireAdmin, async (req, res, next) => {
  try {
    await query(
      `INSERT INTO system_settings (key,value,updated_by,updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`,
      [req.params.key, JSON.stringify(req.body.value), req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================================================================
   FEATURE FLAGS
================================================================ */
router.get('/flags', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key,enabled,rollout_pct,updated_at FROM feature_flags ORDER BY key`);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.patch('/flags/:key', requireAdmin, async (req, res, next) => {
  try {
    const { enabled, rolloutPct } = req.body || {};
    await query(
      `INSERT INTO feature_flags (key,enabled,rollout_pct,updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET enabled=$2, rollout_pct=$3, updated_at=now()`,
      [req.params.key, !!enabled, Number(rolloutPct ?? 0)]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================================================================
   LOG DE AUDITORÍA
================================================================ */
router.get('/audit', requireAdmin, async (req, res, next) => {
  try {
    const { action, entity, actorId, limit = 50, offset = 0 } = req.query;
    const conds = ['1=1'], vals = [];
    let i = 1;
    if (action)  { conds.push(`a.action ILIKE $${i++}`); vals.push('%' + action + '%'); }
    if (entity)  { conds.push(`a.entity=$${i++}`);       vals.push(entity); }
    if (actorId) { conds.push(`a.actor_id=$${i++}`);     vals.push(actorId); }
    vals.push(Number(limit), Number(offset));
    const { rows } = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.meta, a.created_at,
              p.display_name AS actor_name
         FROM audit_log a LEFT JOIN profiles p ON p.user_id=a.actor_id
        WHERE ${conds.join(' AND ')}
        ORDER BY a.created_at DESC LIMIT $${i} OFFSET $${i+1}`,
      vals
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

export default router;
