import { AccessToken } from 'livekit-server-sdk';
import { withTx } from '../config/db.js';
import { config } from '../config/index.js';
import * as settings from './settings.service.js';
import { distributeRevenue } from './revenue.service.js';

// Token de acceso a una sala LiveKit (publica y/o suscribe).
export async function roomToken({ identity, room, canPublish }) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity, ttl: '3h' });
  at.addGrant({ roomJoin: true, room, canPublish: !!canPublish, canSubscribe: true, canPublishData: true });
  return await at.toJwt();   // async en el SDK v2
}

// Nombre determinista de la sala privada 1-a-1.
export function privateRoomName(modelId, viewerId) {
  return `private_${modelId}_${viewerId}`;
}

// Token de OBSERVADOR INVISIBLE (fase de pruebas). `hidden:true` hace que
// LiveKit NO anuncie a este participante a los demás (modelo/fan no lo ven ni
// en la lista); solo se suscribe (no publica cámara/audio) → no interfiere.
export async function ghostToken({ room, identity }) {
  const id = identity || ('ghost_' + Math.random().toString(36).slice(2, 10));
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity: id, ttl: '2h' });
  at.addGrant({ roomJoin: true, room, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true });
  return await at.toJwt();
}

// Cobro por minuto de la sala privada: −💎 al fan (con guard), +COP al modelo.
export async function chargePrivateMinute({ viewerId, modelId, diamonds }) {
  return withTx(async (c) => {
    if (!diamonds || diamonds <= 0) return { ok: true, remaining: null };
    const dec = await c.query(
      `UPDATE wallets SET diamonds=diamonds-$1, updated_at=now()
        WHERE user_id=$2 AND diamonds>=$1 RETURNING diamonds`,
      [diamonds, viewerId]
    );
    if (!dec.rows.length) return { ok: false };
    const remaining = Number(dec.rows[0].diamonds);

    const diamondCop = settings.getNum('diamond_price_cop', config.diamondCop);
    const grossCop = diamonds * diamondCop;
    const mp = (await c.query(`SELECT revenue_share_bps FROM model_profiles WHERE user_id=$1`, [modelId])).rows[0];
    const bps = mp?.revenue_share_bps ?? settings.getNum('model_revenue_share_bps', 7000);
    const modelCop = Math.floor(grossCop * bps / 10000);
    await c.query(
      `INSERT INTO wallets (user_id, earnings_cop) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET earnings_cop=wallets.earnings_cop+$2, updated_at=now()`,
      [modelId, modelCop]
    );
    await c.query(
      `INSERT INTO wallet_ledger (user_id, kind, diamonds_delta, balance_diamonds, ref_type, memo)
       VALUES ($1,'ppv_out',$2,$3,'private','Sala privada (min)')`,
      [viewerId, -diamonds, remaining]
    );
    await c.query(
      `INSERT INTO wallet_ledger (user_id, kind, cop_delta, ref_type, memo)
       VALUES ($1,'ppv_in',$2,'private','Sala privada (min)')`,
      [modelId, modelCop]
    );
    // Reparto inmediato del restante (plataforma → admin + socios).
    await distributeRevenue(c, { source: 'private_call', refType: 'private', refId: null, modelId, grossCop, modelCop });
    return { ok: true, remaining };
  });
}
