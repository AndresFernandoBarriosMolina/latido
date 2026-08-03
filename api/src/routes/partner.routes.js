import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePartner } from '../middleware/rbac.js';
import { query } from '../config/db.js';
import { redis } from '../config/redis.js';
import { applyDecision } from '../services/kyc.service.js';

// ============================================================================
//  Portal del SOCIO (/socio). Acceso con rol 'partner' (o admin para soporte).
//  Solo lectura financiera + participación + métricas + KYC + auditoría.
//  NO puede tocar configuración, usuarios, ni gestionar socios/pagos.
// ============================================================================
const router = Router();
router.use(authenticate);
router.use(requirePartner);

async function myPartner(userId) {
  const { rows } = await query('SELECT * FROM partners WHERE user_id=$1 LIMIT 1', [userId]);
  return rows[0] || null;
}

// Panel: mi participación + finanzas globales (ingresos/egresos) + métricas.
router.get('/dashboard', async (req, res, next) => {
  try {
    const me = await myPartner(req.user.id);
    const totals = (await query(
      `SELECT COALESCE(sum(gross_cop),0)::bigint gross, COALESCE(sum(model_cop),0)::bigint model,
              COALESCE(sum(platform_cop),0)::bigint platform, COALESCE(sum(admin_cop),0)::bigint admin,
              COALESCE(sum(partners_cop),0)::bigint partners, count(*)::int n FROM revenue_events`)).rows[0];
    const bySource = (await query(
      `SELECT source, COALESCE(sum(gross_cop),0)::bigint gross, COALESCE(sum(platform_cop),0)::bigint platform, count(*)::int n
         FROM revenue_events GROUP BY source ORDER BY gross DESC`)).rows;
    const partners = (await query(
      `SELECT id, name, share_bps, is_active, balance_cop,
              (SELECT COALESCE(sum(amount_cop),0)::bigint FROM partner_ledger pl WHERE pl.partner_id=p.id AND pl.amount_cop>0) AS total_earned_cop
         FROM partners p ORDER BY p.is_active DESC, p.balance_cop DESC`)).rows;
    const modelPaid = (await query(`SELECT COALESCE(sum(amount_cop),0)::bigint t FROM payouts WHERE status='paid'`)).rows[0].t;
    const partnerSettled = (await query(`SELECT COALESCE(sum(-amount_cop),0)::bigint t FROM partner_ledger WHERE amount_cop<0`)).rows[0].t;
    const recent = (await query(
      `SELECT source, gross_cop, model_cop, admin_cop, partners_cop, created_at
         FROM revenue_events ORDER BY created_at DESC LIMIT 25`)).rows;

    const [uCount, mCount, liveNow, pendKyc] = await Promise.all([
      query(`SELECT count(*)::int n FROM users`),
      query(`SELECT count(*)::int n FROM users WHERE role='model'`),
      query(`SELECT count(*)::int n FROM model_profiles WHERE is_live=true`),
      query(`SELECT count(*)::int n FROM kyc_verifications WHERE status IN ('submitted','in_review')`),
    ]);
    const activeCalls = (await query(`SELECT count(*)::int n FROM video_calls WHERE status='active'`)).rows[0].n;
    let dbMs = null; try { const t = Date.now(); await query('SELECT 1'); dbMs = Date.now() - t; } catch {}
    let redisOk = false; try { await redis.ping(); redisOk = true; } catch {}

    res.json({
      me: me ? { name: me.name, shareBps: me.share_bps, balanceCop: Number(me.balance_cop), isActive: me.is_active } : null,
      finance: {
        totals, bySource, partners, recent,
        egresos: { modelPayoutsPaidCop: Number(modelPaid), partnerSettledCop: Number(partnerSettled) },
      },
      system: {
        counts: { users: uCount.rows[0].n, models: mCount.rows[0].n, liveNow: liveNow.rows[0].n, activeCalls, pendingKyc: pendKyc.rows[0].n },
        db: { latencyMs: dbMs }, redis: { ok: redisOk }, time: new Date().toISOString(),
      },
    });
  } catch (e) { next(e); }
});

// Movimientos de mi participación.
router.get('/ledger', async (req, res, next) => {
  try {
    const me = await myPartner(req.user.id);
    if (!me) return res.json({ items: [] });
    const { rows } = await query(
      `SELECT amount_cop, balance_cop, memo, created_at FROM partner_ledger WHERE partner_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [me.id]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// KYC: cola + decisión.
router.get('/kyc/queue', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT k.id, k.user_id, k.full_name, k.document_type, k.status, k.submitted_at
         FROM kyc_verifications k WHERE k.status IN ('submitted','in_review') ORDER BY k.submitted_at ASC`);
    res.json({ items: rows });
  } catch (e) { next(e); }
});
router.post('/kyc/:id/decision', async (req, res, next) => {
  try {
    const { decision, notes } = req.body || {};
    if (!['approve', 'reject', 'approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'invalid' });
    const k = (await query(`SELECT user_id FROM kyc_verifications WHERE id=$1`, [req.params.id])).rows[0];
    if (!k) return res.status(404).json({ error: 'not_found' });
    await applyDecision({ kycId: req.params.id, userId: k.user_id, decision, reviewerId: req.user.id, notes: notes || null, source: 'manual', ip: req.ip });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Auditoría (lectura).
router.get('/audit', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.ip, a.created_at, p.display_name AS actor_name
         FROM audit_log a LEFT JOIN profiles p ON p.user_id=a.actor_id
        ORDER BY a.created_at DESC LIMIT $1`, [Number(req.query.limit) || 60]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

export default router;
