import { query, withTx } from '../config/db.js';
import { config } from '../config/index.js';
import * as settings from './settings.service.js';
import { distributeRevenue } from './revenue.service.js';

// ============================================================================
//  Regalos. `sendGift` es atómico: descuenta 💎 al emisor (con guard de saldo),
//  registra el regalo y acredita al modelo en COP según su revenue_share.
// ============================================================================
export async function sendGift({ senderId, modelId, giftId, context = 'live', contextId = null }) {
  return withTx(async (c) => {
    const gift = (await c.query(
      `SELECT id, name, emoji, cost_diamonds, animation FROM gift_catalog WHERE id=$1 AND is_active=true`,
      [giftId]
    )).rows[0];
    if (!gift) throw new Error('gift_not_found');
    const cost = gift.cost_diamonds;

    // Descontar al emisor con guard (no permite saldo negativo).
    const dec = await c.query(
      `UPDATE wallets SET diamonds=diamonds-$1, updated_at=now()
        WHERE user_id=$2 AND diamonds>=$1 RETURNING diamonds`,
      [cost, senderId]
    );
    if (!dec.rows.length) throw new Error('insufficient_diamonds');
    const senderDiamonds = Number(dec.rows[0].diamonds);

    // Ingreso del modelo (revenue_share sobre el valor en COP de los 💎).
    const diamondCop = settings.getNum('diamond_price_cop', config.diamondCop);
    const grossCop = cost * diamondCop;
    const mp = (await c.query(`SELECT revenue_share_bps FROM model_profiles WHERE user_id=$1`, [modelId])).rows[0];
    const bps = mp?.revenue_share_bps ?? settings.getNum('model_revenue_share_bps', 7000);
    const modelCop = Math.floor(grossCop * bps / 10000);
    await c.query(
      `INSERT INTO wallets (user_id, earnings_cop) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET earnings_cop=wallets.earnings_cop+$2, updated_at=now()`,
      [modelId, modelCop]
    );

    const g = (await c.query(
      `INSERT INTO gifts_sent (gift_id, sender_id, recipient_id, context, context_id, cost_diamonds, model_earned_cop)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [gift.id, senderId, modelId, context, contextId, cost, modelCop]
    )).rows[0];

    await c.query(
      `INSERT INTO wallet_ledger (user_id, kind, diamonds_delta, balance_diamonds, ref_type, ref_id, memo)
       VALUES ($1,'gift_out',$2,$3,'gift',$4,$5)`,
      [senderId, -cost, senderDiamonds, g.id, `Regalo ${gift.name}`]
    );
    await c.query(
      `INSERT INTO wallet_ledger (user_id, kind, cop_delta, ref_type, ref_id, memo)
       VALUES ($1,'gift_in',$2,'gift',$3,$4)`,
      [modelId, modelCop, g.id, `Regalo recibido ${gift.name}`]
    );

    // Reparto inmediato del restante (plataforma → admin + socios).
    await distributeRevenue(c, { source: 'gift', refType: 'gift', refId: g.id, modelId, grossCop, modelCop });

    return { id: g.id, emoji: gift.emoji, name: gift.name, cost, animation: gift.animation, senderDiamonds, modelEarnedCop: modelCop };
  });
}

// Catálogo activo, sin duplicados por nombre, ordenado por costo.
export async function giftCatalog() {
  const { rows } = await query(
    `SELECT DISTINCT ON (name) id, name, emoji, cost_diamonds, animation, sort_order
       FROM gift_catalog WHERE is_active=true
      ORDER BY name, sort_order, cost_diamonds`
  );
  return rows.sort((a, b) => (a.sort_order - b.sort_order) || (a.cost_diamonds - b.cost_diamonds));
}
