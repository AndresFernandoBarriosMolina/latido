import * as settings from './settings.service.js';

// ============================================================================
//  Reparto del ingreso de la plataforma (el "restante" tras pagar a la modelo).
//
//    restante  = bruto − parte_modelo
//    admin     = restante × admin_share_bps / 10000        (sostenibilidad)
//    socios    = restante − admin  → se divide entre socios activos según su
//                peso (share_bps relativo). Sobrantes de redondeo y, si no hay
//                socios, TODO el pool → al administrador (nada se pierde).
//
//  Se ejecuta DENTRO de la transacción que acredita a la modelo (mismo client
//  `c`), de forma inmediata al enviar regalo / finalizar privado / suscribirse.
// ============================================================================
export async function distributeRevenue(c, { source, refType = null, refId = null, modelId = null, grossCop, modelCop }) {
  const gross = Math.max(0, Math.floor(Number(grossCop) || 0));
  const model = Math.max(0, Math.floor(Number(modelCop) || 0));
  const platformCop = Math.max(0, gross - model);
  if (platformCop <= 0) return { platformCop: 0, adminCop: 0, partnersCop: 0 };

  const adminBps = Math.min(10000, Math.max(0, settings.getNum('admin_share_bps', 500)));
  let adminCop = Math.floor(platformCop * adminBps / 10000);
  const partnersPool = platformCop - adminCop;

  // Socios activos con peso > 0.
  const partners = (await c.query(
    'SELECT id, share_bps FROM partners WHERE is_active=true AND share_bps > 0'
  )).rows;
  const totalWeight = partners.reduce((s, p) => s + Number(p.share_bps), 0);

  const allocations = [];
  let distributed = 0;
  if (totalWeight > 0 && partnersPool > 0) {
    for (const p of partners) {
      const amt = Math.floor(partnersPool * Number(p.share_bps) / totalWeight);
      if (amt > 0) { allocations.push({ id: p.id, amt }); distributed += amt; }
    }
  }
  // Sobrante (redondeo + sin socios) va al administrador.
  adminCop += (partnersPool - distributed);
  const partnersCop = distributed;

  const ev = (await c.query(
    `INSERT INTO revenue_events (source, ref_type, ref_id, model_id, gross_cop, model_cop, platform_cop, admin_cop, partners_cop, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [source, refType, refId, modelId, gross, model, platformCop, adminCop, partnersCop,
     JSON.stringify({ adminBps, allocations })]
  )).rows[0];

  for (const a of allocations) {
    const upd = (await c.query(
      'UPDATE partners SET balance_cop = balance_cop + $1, updated_at = now() WHERE id=$2 RETURNING balance_cop',
      [a.amt, a.id]
    )).rows[0];
    await c.query(
      `INSERT INTO partner_ledger (partner_id, event_id, amount_cop, balance_cop, memo)
       VALUES ($1,$2,$3,$4,$5)`,
      [a.id, ev.id, a.amt, Number(upd.balance_cop), source]
    );
  }

  return { eventId: ev.id, platformCop, adminCop, partnersCop };
}
