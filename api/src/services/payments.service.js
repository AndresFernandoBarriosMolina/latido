import crypto from 'node:crypto';
import { query, withTx } from '../config/db.js';
import { config } from '../config/index.js';

// ============================================================================
//  Pagos con Wompi (pasarela colombiana: PSE, Nequi, tarjeta, etc.).
//
//  Flujo seguro:
//   1) /checkout crea un `payment` (pending) con referencia única y firma de
//      INTEGRIDAD; el navegador va al Web Checkout de Wompi (redirección).
//   2) Wompi notifica por WEBHOOK firmado (events secret). Aquí se valida la
//      firma, se aplica idempotencia (payment_webhooks.event_id UNIQUE) y SOLO
//      entonces se acreditan diamantes / se activa la suscripción.
//
//  El dinero nunca se "confía" desde el cliente: el saldo solo cambia tras un
//  webhook válido de Wompi. Todo movimiento queda en wallet_ledger (append-only).
// ============================================================================

// Firma de integridad del Web Checkout: SHA256(reference + amountInCents + currency + secret)
export function integritySignature(reference, amountInCents, currency = config.wompi.currency) {
  return crypto.createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${config.wompi.integritySecret || ''}`)
    .digest('hex');
}

// Valida la firma del evento (webhook) de Wompi.
//  checksum = SHA256( concat(valores de signature.properties) + timestamp + events_secret )
export function verifyEventSignature(body) {
  const sig = body?.signature;
  if (!sig?.checksum || !Array.isArray(sig.properties)) return false;
  const concatenated = sig.properties.map((path) => {
    // path tipo "transaction.amount_in_cents" → navegar body.data
    return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), body.data);
  }).join('');
  const raw = `${concatenated}${body.timestamp}${config.wompi.eventsSecret || ''}`;
  const expected = crypto.createHash('sha256').update(raw).digest('hex');
  // Comparación en tiempo constante.
  const a = Buffer.from(expected), b = Buffer.from(String(sig.checksum));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newReference(purpose) {
  return `LAT-${purpose}-${crypto.randomUUID()}`;
}

// Aplica una transacción APROBADA (idempotente). Acredita diamantes (topup) o
// activa la suscripción + reparte ingresos a la modelo (subscription).
export async function applyApprovedPayment(payment, transaction) {
  return withTx(async (c) => {
    // Re-leer el pago dentro de la transacción y bloquear (evita doble crédito).
    const p = (await c.query(`SELECT * FROM payments WHERE id=$1 FOR UPDATE`, [payment.id])).rows[0];
    if (!p || p.status === 'approved') return { applied: false, reason: 'already_or_missing' };

    await c.query(`UPDATE payments SET status='approved', gateway_ref=$2, paid_at=now() WHERE id=$1`,
      [p.id, transaction?.id || null]);

    if (p.purpose === 'topup') {
      const pkg = (await c.query(`SELECT diamonds, bonus_diamonds FROM diamond_packages WHERE id=$1`, [p.package_id])).rows[0];
      const total = (pkg?.diamonds || 0) + (pkg?.bonus_diamonds || 0);
      const w = (await c.query(
        `INSERT INTO wallets (user_id, diamonds) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET diamonds = wallets.diamonds + $2, updated_at=now()
         RETURNING diamonds`, [p.user_id, total]
      )).rows[0];
      await c.query(
        `INSERT INTO wallet_ledger (user_id, kind, diamonds_delta, cop_delta, balance_diamonds, ref_type, ref_id, memo)
         VALUES ($1,'topup',$2,$3,$4,'payment',$5,$6)`,
        [p.user_id, total, p.amount_cop, w.diamonds, p.id, `Recarga ${total} 💎`]
      );
      return { applied: true, kind: 'topup', diamonds: total };
    }

    if (p.purpose === 'subscription' && p.subscription_id) {
      const sub = (await c.query(
        `UPDATE subscriptions SET status='active', started_at=now(),
            current_period_end = now() + interval '30 days', cancelled_at=NULL
          WHERE id=$1 RETURNING model_id, subscriber_id, price_cop`,
        [p.subscription_id]
      )).rows[0];
      // Reparto: la modelo recibe revenue_share_bps; la plataforma el resto.
      const mp = (await c.query(`SELECT revenue_share_bps FROM model_profiles WHERE user_id=$1`, [sub.model_id])).rows[0];
      const share = Math.floor(Number(p.amount_cop) * (mp?.revenue_share_bps ?? 7000) / 10000);
      await c.query(
        `INSERT INTO wallets (user_id, earnings_cop) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET earnings_cop = wallets.earnings_cop + $2, updated_at=now()`,
        [sub.model_id, share]
      );
      await c.query(
        `INSERT INTO wallet_ledger (user_id, kind, cop_delta, ref_type, ref_id, memo)
         VALUES ($1,'subscription',$2,'subscription',$3,$4)`,
        [sub.model_id, share, p.subscription_id, `Suscripción de fan`]
      );
      return { applied: true, kind: 'subscription', modelShareCop: share };
    }
    return { applied: true, kind: 'unknown' };
  });
}

export async function markPaymentFailed(paymentId, status, transaction) {
  await query(`UPDATE payments SET status=$2, gateway_ref=$3 WHERE id=$1 AND status='pending'`,
    [paymentId, status, transaction?.id || null]);
}
