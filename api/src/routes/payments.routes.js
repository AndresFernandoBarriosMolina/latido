import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { config } from '../config/index.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/security.js';
import {
  integritySignature, verifyEventSignature, newReference,
  applyApprovedPayment, markPaymentFailed,
} from '../services/payments.service.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Paquetes de diamantes (público)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/packages', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, diamonds, bonus_diamonds, price_cop
         FROM diamond_packages WHERE is_active = true ORDER BY sort_order, price_cop`
    );
    res.json({ items: rows, currency: config.wompi.currency });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Billetera del usuario
// ─────────────────────────────────────────────────────────────────────────────
router.get('/wallet', authenticate, async (req, res, next) => {
  try {
    const w = (await query(`SELECT diamonds, earnings_cop FROM wallets WHERE user_id=$1`, [req.user.id])).rows[0]
      || { diamonds: 0, earnings_cop: 0 };
    const { rows: ledger } = await query(
      `SELECT kind, diamonds_delta, cop_delta, memo, created_at
         FROM wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ diamonds: Number(w.diamonds || 0), earningsCop: Number(w.earnings_cop || 0), ledger });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Checkout: crea el pago (pending) y devuelve los datos del Web Checkout de Wompi
// ─────────────────────────────────────────────────────────────────────────────
const checkoutSchema = z.object({
  purpose: z.enum(['topup', 'subscription']),
  packageId: z.string().uuid().optional(),
  modelId: z.string().uuid().optional(),
});

router.post('/checkout', authenticate, strictLimiter, async (req, res, next) => {
  try {
    const d = checkoutSchema.parse(req.body);
    let amountCop, packageId = null, subscriptionId = null;

    if (d.purpose === 'topup') {
      if (!d.packageId) return res.status(400).json({ error: 'package_required' });
      const pkg = (await query(`SELECT id, price_cop FROM diamond_packages WHERE id=$1 AND is_active=true`, [d.packageId])).rows[0];
      if (!pkg) return res.status(404).json({ error: 'package_not_found' });
      amountCop = Number(pkg.price_cop); packageId = pkg.id;
    } else {
      if (!d.modelId) return res.status(400).json({ error: 'model_required' });
      if (d.modelId === req.user.id) return res.status(400).json({ error: 'cannot_subscribe_self' });
      const mp = (await query(`SELECT monthly_price_cop FROM model_profiles WHERE user_id=$1 AND published=true`, [d.modelId])).rows[0];
      if (!mp) return res.status(404).json({ error: 'model_not_found' });
      amountCop = Number(mp.monthly_price_cop);
      // Pre-crear/asegurar la suscripción en estado past_due (se activa en el webhook).
      subscriptionId = (await query(
        `INSERT INTO subscriptions (subscriber_id, model_id, status, price_cop, current_period_end)
         VALUES ($1,$2,'past_due',$3, now())
         ON CONFLICT (subscriber_id, model_id)
           DO UPDATE SET price_cop=EXCLUDED.price_cop
         RETURNING id`,
        [req.user.id, d.modelId, amountCop]
      )).rows[0].id;
    }

    const reference = newReference(d.purpose);
    const amountInCents = amountCop * 100;
    await query(
      `INSERT INTO payments (user_id, purpose, amount_cop, status, gateway, reference, package_id, subscription_id)
       VALUES ($1,$2,$3,'pending','wompi',$4,$5,$6)`,
      [req.user.id, d.purpose, amountCop, reference, packageId, subscriptionId]
    );

    const signature = integritySignature(reference, amountInCents);
    const redirectUrl = `${config.publicUrl || ''}/?payment=return&ref=${reference}`;
    res.status(201).json({
      reference, amountInCents, currency: config.wompi.currency,
      publicKey: config.wompi.publicKey || '',
      signature, redirectUrl,
      checkoutUrl: config.wompi.checkoutUrl,
      mode: config.wompi.mode,
      amountCop,
    });
  } catch (e) {
    if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' });
    next(e);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook de Wompi (PÚBLICO, validado por firma). Único punto que mueve saldo.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res, next) => {
  try {
    const body = req.body || {};
    const tx = body?.data?.transaction;

    // 1) Validar la firma ANTES de tocar la BD: una petición no auténtica se
    //    rechaza sin escribir nada (evita basura y abuso del endpoint público).
    if (!verifyEventSignature(body)) return res.status(401).json({ error: 'bad_signature' });

    // 2) Idempotencia + registro crudo (payment_webhooks.event_id UNIQUE).
    const eventId = tx ? `${tx.id}:${tx.status}` : crypto.randomUUID();
    try {
      await query(
        `INSERT INTO payment_webhooks (gateway, event_id, signature, signature_ok, payload, processed_at)
         VALUES ('wompi',$1,$2,true,$3, now())`,
        [eventId, body?.signature?.checksum || null, JSON.stringify(body)]
      );
    } catch (e) {
      if (e.code === '23505') return res.json({ ok: true, duplicate: true });   // ya procesado
      throw e;
    }

    if (body.event !== 'transaction.updated' || !tx) return res.json({ ok: true, ignored: true });

    const payment = (await query(`SELECT * FROM payments WHERE reference=$1`, [tx.reference])).rows[0];
    if (!payment) return res.json({ ok: true, no_payment: true });

    // El monto del evento DEBE coincidir con el del pago (anti-manipulación).
    if (Number(tx.amount_in_cents) !== Number(payment.amount_cop) * 100) {
      await markPaymentFailed(payment.id, 'error', tx);
      return res.json({ ok: true, amount_mismatch: true });
    }

    if (tx.status === 'APPROVED') {
      const r = await applyApprovedPayment(payment, tx);
      return res.json({ ok: true, ...r });
    }
    const failMap = { DECLINED: 'declined', VOIDED: 'voided', ERROR: 'error' };
    if (failMap[tx.status]) {
      await markPaymentFailed(payment.id, failMap[tx.status], tx);
      return res.json({ ok: true, failed: tx.status });
    }
    res.json({ ok: true, pending: true });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suscripciones del usuario
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscriptions', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.model_id, s.status, s.current_period_end, s.auto_renew,
              p.display_name AS model_name, mp.handle
         FROM subscriptions s
         JOIN model_profiles mp ON mp.user_id = s.model_id
         LEFT JOIN profiles p ON p.user_id = s.model_id
        WHERE s.subscriber_id=$1 AND s.status IN ('active','past_due')
        ORDER BY s.current_period_end DESC`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post('/subscriptions/cancel', authenticate, async (req, res, next) => {
  try {
    const { modelId } = z.object({ modelId: z.string().uuid() }).parse(req.body);
    const { rowCount } = await query(
      `UPDATE subscriptions SET auto_renew=false, cancelled_at=now()
        WHERE subscriber_id=$1 AND model_id=$2 AND status='active'`,
      [req.user.id, modelId]
    );
    if (!rowCount) return res.status(404).json({ error: 'no_active_subscription' });
    res.json({ ok: true, note: 'No se renovará al final del período actual.' });
  } catch (e) { next(e); }
});

export default router;
