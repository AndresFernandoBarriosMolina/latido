import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireStaff } from '../middleware/rbac.js';
import { query, withTx } from '../config/db.js';
import { moderationReadMessages } from '../services/messages.service.js';
import { applyDecision } from '../services/kyc.service.js';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { ghostToken } from '../services/live.service.js';
import { loadSettings } from '../services/settings.service.js';
import { hashPassword } from '../services/password.service.js';

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
              (SELECT count(*)::int FROM subscriptions s WHERE s.model_id=u.id AND s.status='active') AS active_subscribers,
              u.deleted_at,
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

// Ajuste de billetera (💎 y ganancias COP), positivo o negativo — soporte/PQRS.
router.post('/users/:id/wallet', requireAdmin, async (req, res, next) => {
  try {
    const dDelta = Math.trunc(Number(req.body?.diamondsDelta) || 0);
    const eDelta = Math.trunc(Number(req.body?.earningsDelta) || 0);
    if (!dDelta && !eDelta) return res.status(400).json({ error: 'nothing_to_change' });
    const memo = String(req.body?.memo || 'Ajuste administrativo').slice(0, 120);
    const uid = req.params.id;
    if (!(await query(`SELECT 1 FROM users WHERE id=$1`, [uid])).rows[0]) return res.status(404).json({ error: 'user_not_found' });
    const out = await withTx(async (c) => {
      await c.query(`INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [uid]);
      const w = (await c.query(
        `UPDATE wallets SET diamonds=diamonds+$1, earnings_cop=earnings_cop+$2, updated_at=now()
          WHERE user_id=$3 RETURNING diamonds, earnings_cop`, [dDelta, eDelta, uid])).rows[0];
      if (dDelta) await c.query(`INSERT INTO wallet_ledger (user_id,kind,diamonds_delta,balance_diamonds,ref_type,memo) VALUES ($1,'adjustment',$2,$3,'admin_adjust',$4)`,
        [uid, dDelta, Number(w.diamonds), memo]);
      if (eDelta) await c.query(`INSERT INTO wallet_ledger (user_id,kind,cop_delta,ref_type,memo) VALUES ($1,'adjustment',$2,'admin_adjust',$3)`,
        [uid, eDelta, memo]);
      await c.query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'wallet.adjust','users',$2,$3,$4)`,
        [req.user.id, uid, req.ip, JSON.stringify({ dDelta, eDelta, memo })]);
      return w;
    });
    res.json({ ok: true, diamonds: Number(out.diamonds), earningsCop: Number(out.earnings_cop) });
  } catch (e) {
    if (e?.code === '23514') return res.status(400).json({ error: 'would_go_negative' });
    next(e);
  }
});

// Historial de pagos del usuario.
router.get('/users/:id/payments', requireStaff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, purpose, amount_cop, method, status, gateway, reference, created_at, paid_at
         FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.id]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Suscripciones: como fan (a modelos) y como modelo (sus suscriptores).
router.get('/users/:id/subscriptions', requireStaff, async (req, res, next) => {
  try {
    const asSubscriber = (await query(
      `SELECT s.id, s.status, s.price_cop, s.current_period_end, s.auto_renew, s.cancelled_at,
              COALESCE(p.display_name, mp.handle) AS model_name
         FROM subscriptions s
         LEFT JOIN profiles p ON p.user_id=s.model_id
         LEFT JOIN model_profiles mp ON mp.user_id=s.model_id
        WHERE s.subscriber_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [req.params.id])).rows;
    const asModel = (await query(
      `SELECT s.id, s.status, s.price_cop, s.current_period_end, s.auto_renew,
              p.display_name AS subscriber_name
         FROM subscriptions s LEFT JOIN profiles p ON p.user_id=s.subscriber_id
        WHERE s.model_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [req.params.id])).rows;
    res.json({ asSubscriber, asModel });
  } catch (e) { next(e); }
});

// Cancelar una suscripción activa (soporte/PQRS).
router.post('/subscriptions/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE subscriptions SET status='cancelled', auto_renew=false, cancelled_at=now()
        WHERE id=$1 AND status='active' RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found_or_inactive' });
    await query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'subscription.cancel','subscriptions',$2,$3,'{}')`,
      [req.user.id, req.params.id, req.ip]).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Eliminar (anonimizar + desactivar) una cuenta — Habeas Data / PQRS.
router.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const uid = req.params.id;
    const target = (await query(`SELECT role FROM users WHERE id=$1`, [uid])).rows[0];
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (target.role === 'admin') return res.status(403).json({ error: 'cannot_delete_admin' });
    if (uid === req.user.id) return res.status(403).json({ error: 'cannot_delete_self' });
    await withTx(async (c) => {
      const anon = `deleted_${String(uid).slice(0, 8)}@deleted.local`;
      await c.query(`UPDATE users SET status='banned', deleted_at=now(), email=$2, phone=NULL, email_verified=false, phone_verified=false WHERE id=$1`, [uid, anon]);
      await c.query(`UPDATE profiles SET display_name='Cuenta eliminada', bio=NULL, avatar_key=NULL, city=NULL, interests=NULL WHERE user_id=$1`, [uid]);
      await c.query(`UPDATE model_profiles SET is_live=false, published=false WHERE user_id=$1`, [uid]);
      await c.query(`UPDATE subscriptions SET status='cancelled', auto_renew=false, cancelled_at=now() WHERE subscriber_id=$1 AND status='active'`, [uid]);
      await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [uid]);
      await c.query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'user.delete','users',$2,$3,$4)`,
        [req.user.id, uid, req.ip, JSON.stringify({ anonymized: true })]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
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
    const VALID = ['requested', 'approved', 'processing', 'paid', 'rejected'];
    let { status = 'requested', limit = 50, offset = 0 } = req.query;
    if (status === 'pending') status = 'requested';   // alias tolerante (el enum usa 'requested')
    if (!VALID.includes(status)) status = 'requested'; // evita cast de enum inválido → 500
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
    await loadSettings();                     // aplica el cambio al instante (sin esperar el refresco)
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

/* ================================================================
   SOCIOS (partners) — registro y reparto
================================================================ */
router.get('/partners', requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.name, p.email, p.document, p.share_bps, p.is_active, p.balance_cop, p.notes, p.created_at,
              (p.user_id IS NOT NULL) AS has_access,
              (SELECT COALESCE(sum(amount_cop),0)::bigint FROM partner_ledger pl WHERE pl.partner_id=p.id AND pl.amount_cop>0) AS total_earned_cop
         FROM partners p ORDER BY p.is_active DESC, p.created_at`);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const partnerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160).optional().or(z.literal('')),
  password: z.string().min(8).max(200).optional().or(z.literal('')),
  document: z.string().max(40).optional().or(z.literal('')),
  shareBps: z.number().int().min(0).max(1000000).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

// Crea una cuenta de acceso (rol 'partner') y devuelve su id de usuario.
async function createPartnerUser(c, { email, password, name }) {
  const u = (await c.query(
    `INSERT INTO users (role,status,email,age_verified,age_verified_at,data_consent_at,tos_version)
     VALUES ('partner','active',$1,true,now(),now(),'1.0') RETURNING id`, [email])).rows[0];
  const hash = await hashPassword(password);
  await c.query(`INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)`, [u.id, hash]);
  await c.query(`INSERT INTO profiles (user_id,display_name) VALUES ($1,$2)`, [u.id, name]);
  return u.id;
}

router.post('/partners', requireAdmin, async (req, res, next) => {
  try {
    const d = partnerSchema.parse(req.body);
    const out = await withTx(async (c) => {
      let userId = null;
      if (d.email && d.password) userId = await createPartnerUser(c, { email: d.email, password: d.password, name: d.name });
      const p = (await c.query(
        `INSERT INTO partners (name,email,document,share_bps,notes,user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [d.name, d.email || null, d.document || null, d.shareBps ?? 0, d.notes || null, userId])).rows[0];
      await c.query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'partner.create','partners',$2,$3,$4)`,
        [req.user.id, p.id, req.ip, JSON.stringify({ name: d.name, access: !!userId })]).catch(() => {});
      return { id: p.id, hasAccess: !!userId };
    });
    res.status(201).json(out);
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' });
    if (e?.code === '23505') return res.status(409).json({ error: 'email_in_use' });
    next(e);
  }
});

// Crear/restablecer el acceso (correo + contraseña) de un socio.
router.post('/partners/:id/access', requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || password.length < 8) return res.status(400).json({ error: 'invalid' });
    const p = (await query(`SELECT id, name, user_id FROM partners WHERE id=$1`, [req.params.id])).rows[0];
    if (!p) return res.status(404).json({ error: 'not_found' });
    await withTx(async (c) => {
      if (p.user_id) {
        const hash = await hashPassword(password);
        await c.query(`UPDATE users SET email=$1, role='partner', status='active' WHERE id=$2`, [email, p.user_id]);
        const upd = await c.query(`UPDATE auth_identities SET password_hash=$1 WHERE user_id=$2 AND provider='password'`, [hash, p.user_id]);
        if (!upd.rowCount) await c.query(`INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)`, [p.user_id, hash]);
      } else {
        const uid = await createPartnerUser(c, { email, password, name: p.name });
        await c.query(`UPDATE partners SET email=COALESCE(email,$1), user_id=$2 WHERE id=$3`, [email, uid, p.id]);
      }
      await c.query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'partner.access','partners',$2,$3,$4)`,
        [req.user.id, p.id, req.ip, JSON.stringify({ email })]).catch(() => {});
    });
    res.json({ ok: true });
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'email_in_use' });
    next(e);
  }
});
router.patch('/partners/:id', requireAdmin, async (req, res, next) => {
  try {
    const d = partnerSchema.partial().parse(req.body);
    const sets = [], vals = []; let i = 1;
    if (d.name !== undefined)     { sets.push(`name=$${i++}`);      vals.push(d.name); }
    if (d.email !== undefined)    { sets.push(`email=$${i++}`);     vals.push(d.email || null); }
    if (d.document !== undefined) { sets.push(`document=$${i++}`);  vals.push(d.document || null); }
    if (d.shareBps !== undefined) { sets.push(`share_bps=$${i++}`); vals.push(d.shareBps); }
    if (d.isActive !== undefined) { sets.push(`is_active=$${i++}`); vals.push(d.isActive); }
    if (d.notes !== undefined)    { sets.push(`notes=$${i++}`);     vals.push(d.notes || null); }
    if (!sets.length) return res.json({ ok: true });
    sets.push('updated_at=now()'); vals.push(req.params.id);
    await query(`UPDATE partners SET ${sets.join(',')} WHERE id=$${i}`, vals);
    res.json({ ok: true });
  } catch (e) { if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' }); next(e); }
});
// Consignar al socio: pone su saldo en 0 y registra el pago (auditable).
router.post('/partners/:id/settle', requireAdmin, async (req, res, next) => {
  try {
    const out = await withTx(async (c) => {
      const p = (await c.query(`SELECT balance_cop FROM partners WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!p) return null;
      const amount = Number(p.balance_cop);
      if (amount <= 0) return { amount: 0 };
      await c.query(`UPDATE partners SET balance_cop=0, updated_at=now() WHERE id=$1`, [req.params.id]);
      await c.query(`INSERT INTO partner_ledger (partner_id, amount_cop, balance_cop, memo) VALUES ($1,$2,0,$3)`,
        [req.params.id, -amount, 'Consignación / pago al socio']);
      await c.query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'partner.settle','partners',$2,$3,$4)`,
        [req.user.id, req.params.id, req.ip, JSON.stringify({ amount })]);
      return { amount };
    });
    if (out === null) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, settledCop: out.amount });
  } catch (e) { next(e); }
});

/* ================================================================
   INGRESOS / DISTRIBUCIÓN
================================================================ */
router.get('/revenue', requireAdmin, async (req, res, next) => {
  try {
    const conds = ['1=1'], vals = []; let i = 1;
    const from = req.query.from ? new Date(req.query.from) : null;
    const to   = req.query.to ? new Date(req.query.to) : null;
    if (from && !isNaN(from)) { conds.push(`created_at >= $${i++}`); vals.push(from.toISOString()); }
    if (to && !isNaN(to))     { conds.push(`created_at <= $${i++}`); vals.push(to.toISOString()); }
    const where = conds.join(' AND ');
    const totals = (await query(
      `SELECT COALESCE(sum(gross_cop),0)::bigint gross, COALESCE(sum(model_cop),0)::bigint model,
              COALESCE(sum(platform_cop),0)::bigint platform, COALESCE(sum(admin_cop),0)::bigint admin,
              COALESCE(sum(partners_cop),0)::bigint partners, count(*)::int n
         FROM revenue_events WHERE ${where}`, vals)).rows[0];
    const bySource = (await query(
      `SELECT source, COALESCE(sum(gross_cop),0)::bigint gross, COALESCE(sum(platform_cop),0)::bigint platform, count(*)::int n
         FROM revenue_events WHERE ${where} GROUP BY source ORDER BY gross DESC`, vals)).rows;
    const adminAllTime = (await query(`SELECT COALESCE(sum(admin_cop),0)::bigint t FROM revenue_events`)).rows[0].t;
    const partners = (await query(
      `SELECT id, name, share_bps, is_active, balance_cop,
              (SELECT COALESCE(sum(amount_cop),0)::bigint FROM partner_ledger pl WHERE pl.partner_id=p.id AND pl.amount_cop>0) AS total_earned_cop
         FROM partners p ORDER BY p.is_active DESC, p.balance_cop DESC`)).rows;
    const recent = (await query(
      `SELECT source, gross_cop, model_cop, admin_cop, partners_cop, created_at
         FROM revenue_events WHERE ${where} ORDER BY created_at DESC LIMIT 25`, vals)).rows;
    res.json({ totals, bySource, adminAccumulatedCop: Number(adminAllTime), partners, recent });
  } catch (e) { next(e); }
});

/* ================================================================
   DASHBOARD TÉCNICO — monitoreo del sistema
================================================================ */
router.get('/system', requireAdmin, async (_req, res, next) => {
  try {
    let dbOk = false, dbMs = null, dbVersion = null;
    try { const t = Date.now(); const r = await query('SELECT version() v'); dbOk = true; dbMs = Date.now() - t; dbVersion = String(r.rows[0].v).split(',')[0]; } catch {}
    let redisOk = false, redisMs = null;
    try { const t = Date.now(); await redis.ping(); redisOk = true; redisMs = Date.now() - t; } catch {}
    const [uCount, mCount, liveNow, pendKyc, pendPay] = await Promise.all([
      query(`SELECT count(*)::int n FROM users`),
      query(`SELECT count(*)::int n FROM users WHERE role='model'`),
      query(`SELECT count(*)::int n FROM model_profiles WHERE is_live=true`),
      query(`SELECT count(*)::int n FROM kyc_verifications WHERE status IN ('submitted','in_review')`),
      query(`SELECT count(*)::int n FROM payouts WHERE status='requested'`),
    ]);
    const openRep = await query(`SELECT count(*)::int n FROM reports WHERE status='open'`).catch(() => ({ rows: [{ n: 0 }] }));
    const activeCalls = (await query(`SELECT count(*)::int n FROM video_calls WHERE status='active'`)).rows[0].n;
    res.json({
      time: new Date().toISOString(),
      services: {
        db:      { ok: dbOk, latencyMs: dbMs, version: dbVersion },
        redis:   { ok: redisOk, latencyMs: redisMs },
        livekit: { url: config.livekit.url, configured: !!(config.livekit.apiKey && config.livekit.apiSecret) },
        wompi:   { configured: !!process.env.WOMPI_PRIVATE_KEY },
      },
      process: {
        uptimeSec: Math.round(process.uptime()),
        node: process.version, env: config.env,
        memRssMB: Math.round(process.memoryUsage().rss / 1048576),
      },
      counts: {
        users: uCount.rows[0].n, models: mCount.rows[0].n, liveNow: liveNow.rows[0].n,
        activeCalls, pendingKyc: pendKyc.rows[0].n, openReports: openRep.rows[0].n, pendingPayouts: pendPay.rows[0].n,
      },
    });
  } catch (e) { next(e); }
});

/* ================================================================
   EN VIVO — salas activas + ingreso INVISIBLE (fase de pruebas)
================================================================ */
router.get('/live/rooms', requireAdmin, async (_req, res, next) => {
  try {
    const live = (await query(
      `SELECT mp.user_id AS model_id, mp.handle, p.display_name, ('live_' || mp.user_id) AS room
         FROM model_profiles mp LEFT JOIN profiles p ON p.user_id=mp.user_id
        WHERE mp.is_live=true`)).rows;
    const priv = (await query(
      `SELECT vc.id AS call_id, vc.caller_id, vc.callee_id AS model_id,
              ('private_' || vc.callee_id || '_' || vc.caller_id) AS room, vc.started_at
         FROM video_calls vc WHERE vc.status='active'`)).rows;
    res.json({ live, private: priv });
  } catch (e) { next(e); }
});
router.post('/live/ghost-token', requireAdmin, async (req, res, next) => {
  try {
    const room = String(req.body?.room || '').trim();
    if (!room) return res.status(400).json({ error: 'room_required' });
    const flag = (await query(`SELECT enabled FROM feature_flags WHERE key='admin_ghost_join'`)).rows[0];
    if (!flag?.enabled) return res.status(403).json({ error: 'ghost_join_disabled' });
    if (!config.livekit.apiKey) return res.status(503).json({ error: 'live_not_configured' });
    const token = await ghostToken({ room });
    await query(`INSERT INTO audit_log (actor_id,action,entity,entity_id,ip,meta) VALUES ($1,'admin.ghost_join','live',NULL,$2,$3)`,
      [req.user.id, req.ip, JSON.stringify({ room })]).catch(() => {});
    res.json({ url: config.livekit.url, token, room });
  } catch (e) { next(e); }
});

export default router;
