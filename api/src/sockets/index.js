import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { presence } from '../config/redis.js';
import { query } from '../config/db.js';
import { hasActiveSubscription } from '../middleware/contentGuard.js';
import { saveMessage } from '../services/messages.service.js';
import { sendGift } from '../services/gifts.service.js';
import { roomToken, privateRoomName, chargePrivateMinute } from '../services/live.service.js';
import { modelBlocksUser } from '../services/geo.service.js';

// Limitador simple de eventos por socket (token bucket en memoria). Frena flood
// de señalización/chat de un cliente comprometido sin tocar Redis por evento.
function makeRateLimiter(limit, windowMs) {
  const hits = new Map();   // event -> [timestamps]
  return (socket, event) => {
    const now = Date.now();
    const arr = (hits.get(event) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(event, arr);
    return arr.length <= limit;
  };
}

// Verifica que dos usuarios tengan una llamada en curso (ringing/active) en
// cualquier dirección. Cierra el relay abierto de señalización WebRTC.
async function areCallPeers(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM video_calls
      WHERE status IN ('ringing','active')
        AND ((caller_id=$1 AND callee_id=$2) OR (caller_id=$2 AND callee_id=$1))
      LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}

// Verifica si cualquiera de los dos usuarios ha bloqueado al otro.
async function isBlockedBetween(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)
      LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}

// ============================================================================
//  WebSocket: presencia (en línea / en llamada) + señalización WebRTC.
//  La señalización SOLO transporta SDP/ICE; el video va P2P por WebRTC.
// ============================================================================
export function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: config.security.corsOrigins, credentials: true } });

  // Autenticación del socket por JWT
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const p = jwt.verify(token, config.jwt.accessSecret);
      socket.user = { id: p.sub, role: p.role };
      next();
    } catch { next(new Error('unauthorized')); }
  });

  // ---- Sesiones privadas activas (cobro por minuto). Persiste entre sockets. ----
  const privateSessions = new Map();   // callId -> { modelId, viewerId, interval }
  async function endPrivate(callId, reason) {
    const s = privateSessions.get(callId);
    if (s) { clearInterval(s.interval); privateSessions.delete(callId); }
    await query(
      `UPDATE video_calls SET status='ended', ended_at=now(),
         duration_sec=EXTRACT(EPOCH FROM (now()-started_at))::int
       WHERE id=$1 AND status='active'`, [callId]
    );
    if (s) io.to(`user:${s.modelId}`).to(`user:${s.viewerId}`).emit('private:ended', { callId, reason });
  }
  async function startPrivateBilling(callId, modelId, viewerId, pricePerMin) {
    const charge = async () => {
      const r = await chargePrivateMinute({ viewerId, modelId, diamonds: pricePerMin });
      if (!r.ok) return endPrivate(callId, 'insufficient_funds');
      io.to(`user:${viewerId}`).emit('private:billed', { remaining: r.remaining });
    };
    await charge();                                   // primer minuto por adelantado
    const interval = setInterval(charge, 60_000);     // luego cada minuto
    privateSessions.set(callId, { modelId, viewerId, interval });
  }

  io.on('connection', async (socket) => {
    const uid = socket.user.id;
    socket.join(`user:${uid}`);
    await presence.set(uid, 'online');
    socket.broadcast.emit('presence', { userId: uid, status: 'online' });

    // Rate limit por socket: señalización (rápida) y chat (más holgado).
    const allowSignal = makeRateLimiter(60, 10_000);   // 60 señales / 10 s
    const allowChat   = makeRateLimiter(20, 10_000);   // 20 mensajes / 10 s
    const allowLive   = makeRateLimiter(30, 10_000);   // chat/regalos en vivo
    let liveRoom = null;

    // Heartbeat para mantener presencia
    socket.on('ping:presence', async () => { await presence.set(uid, 'online'); });

    // ---- Invitación a videollamada (requiere suscripción a la modelo) ----
    socket.on('call:invite', async ({ toUserId }, ack) => {
      if (!toUserId || toUserId === uid) return ack?.({ error: 'invalid' });
      if (await isBlockedBetween(uid, toUserId)) return ack?.({ error: 'blocked' });
      const sub = await hasActiveSubscription(uid, toUserId);
      if (!sub) return ack?.({ error: 'subscription_required' });
      const call = (await query(
        `INSERT INTO video_calls (caller_id, callee_id, status) VALUES ($1,$2,'ringing') RETURNING id`,
        [uid, toUserId]
      )).rows[0];
      io.to(`user:${toUserId}`).emit('call:incoming', { callId: call.id, from: uid });
      ack?.({ callId: call.id });
    });

    // ---- Señalización WebRTC (SDP / ICE) ----
    // Solo se relaya entre usuarios con una llamada en curso entre ellos.
    socket.on('rtc:signal', async ({ toUserId, data }, ack) => {
      if (!allowSignal(socket, 'rtc:signal')) return ack?.({ error: 'rate_limited' });
      if (!toUserId || !(await areCallPeers(uid, toUserId)))
        return ack?.({ error: 'no_active_call' });
      io.to(`user:${toUserId}`).emit('rtc:signal', { fromUserId: uid, data });
    });

    // Solo el CALLEE puede aceptar SU llamada en estado 'ringing'. El caller se
    // toma de la BD (no se confía en el cliente).
    socket.on('call:accept', async ({ callId }, ack) => {
      const { rows } = await query(
        `UPDATE video_calls SET status='active', started_at=now()
           WHERE id=$1 AND callee_id=$2 AND status='ringing'
         RETURNING caller_id`,
        [callId, uid]
      );
      if (!rows[0]) return ack?.({ error: 'cannot_accept' });
      await presence.set(uid, 'in_call');
      io.to(`user:${rows[0].caller_id}`).emit('call:accepted', { callId });
      ack?.({ ok: true, callerId: rows[0].caller_id });
    });

    // Rechazar/cancelar una llamada en 'ringing' (callee rechaza o caller cancela).
    socket.on('call:reject', async ({ callId }, ack) => {
      const { rows } = await query(
        `UPDATE video_calls SET status='rejected', ended_at=now()
           WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) AND status='ringing'
         RETURNING caller_id, callee_id`,
        [callId, uid]
      );
      const c = rows[0];
      if (c) io.to(`user:${c.caller_id}`).to(`user:${c.callee_id}`).emit('call:rejected', { callId });
      ack?.({ ok: !!c });
    });

    socket.on('call:end', async ({ callId }) => {
      // Solo un participante de la llamada puede terminarla; el WHERE evita
      // que un usuario cierre llamadas ajenas adivinando el callId.
      const { rows } = await query(
        `UPDATE video_calls SET status='ended', ended_at=now(),
           duration_sec=EXTRACT(EPOCH FROM (now()-started_at))::int
         WHERE id=$1 AND (caller_id=$2 OR callee_id=$2)
         RETURNING caller_id, callee_id`,
        [callId, uid]
      );
      await presence.set(uid, 'online');
      // Notificar SOLO a las dos partes implicadas, nunca con io.emit() global.
      const call = rows[0];
      if (call) {
        io.to(`user:${call.caller_id}`)
          .to(`user:${call.callee_id}`)
          .emit('call:ended', { callId });
      }
    });

    // ---- Chat en tiempo real ----
    // El mensaje se persiste CIFRADO en reposo (messages.body_enc) y se entrega
    // en vivo a la otra parte. Validación de payload, rate limit y bloqueos.
    socket.on('chat:message', async ({ toUserId, message }, ack) => {
      if (!allowChat(socket, 'chat:message')) return ack?.({ error: 'rate_limited' });
      if (!toUserId || typeof message !== 'string') return ack?.({ error: 'invalid' });
      const text = message.trim();
      if (text.length < 1 || text.length > 2000) return ack?.({ error: 'invalid_length' });
      try {
        if (await modelBlocksUser(toUserId, uid)) return ack?.({ error: 'blocked' });
        const saved = await saveMessage({ fromId: uid, toId: toUserId, text });
        io.to(`user:${toUserId}`).emit('chat:message', {
          id: saved.id, conversationId: saved.conversationId,
          fromUserId: uid, message: text, createdAt: saved.createdAt,
        });
        ack?.({ ok: true, id: saved.id, conversationId: saved.conversationId });
      } catch (e) {
        ack?.({ error: e.message === 'blocked' ? 'blocked' : 'send_failed' });
      }
    });

    // ======================================================================
    //  TRANSMISIÓN EN VIVO (salas live:<modelId> para chat/regalos/espectadores)
    // ======================================================================
    socket.on('live:join', async ({ modelId }, ack) => {
      if (!modelId) return ack?.({ error: 'invalid' });
      if (await modelBlocksUser(modelId, uid)) return ack?.({ error: 'blocked' });
      liveRoom = `live:${modelId}`;
      socket.join(liveRoom);
      const count = io.sockets.adapter.rooms.get(liveRoom)?.size || 1;
      io.to(liveRoom).emit('live:viewers', { count });
      ack?.({ ok: true, viewers: count });
    });
    socket.on('live:leave', ({ modelId }) => {
      const r = modelId ? `live:${modelId}` : liveRoom;
      if (r) { socket.leave(r); io.to(r).emit('live:viewers', { count: io.sockets.adapter.rooms.get(r)?.size || 0 }); }
    });
    socket.on('live:chat', async ({ modelId, text }, ack) => {
      if (!allowLive(socket, 'live:chat')) return ack?.({ error: 'rate_limited' });
      const t = typeof text === 'string' ? text.trim() : '';
      if (!modelId || t.length < 1 || t.length > 300) return ack?.({ error: 'invalid' });
      io.to(`live:${modelId}`).emit('live:chat', { fromUserId: uid, text: t, at: Date.now() });
      ack?.({ ok: true });
    });
    socket.on('live:gift', async ({ modelId, giftId }, ack) => {
      if (!allowLive(socket, 'live:gift')) return ack?.({ error: 'rate_limited' });
      if (!modelId || !giftId) return ack?.({ error: 'invalid' });
      try {
        const g = await sendGift({ senderId: uid, modelId, giftId, context: 'live', contextId: modelId });
        io.to(`live:${modelId}`).emit('live:gift', { emoji: g.emoji, name: g.name, cost: g.cost, from: uid, at: Date.now() });
        ack?.({ ok: true, diamonds: g.senderDiamonds });
      } catch (e) { ack?.({ error: e.message || 'gift_failed' }); }
    });

    // ======================================================================
    //  SALAS PRIVADAS 1-a-1 (show pagado por minuto sobre LiveKit)
    // ======================================================================
    socket.on('private:request', async ({ modelId }, ack) => {
      if (!modelId || modelId === uid) return ack?.({ error: 'invalid' });
      if (await isBlockedBetween(uid, modelId)) return ack?.({ error: 'blocked' });
      if (await modelBlocksUser(modelId, uid)) return ack?.({ error: 'blocked' });
      const mp = (await query(`SELECT accepts_calls, call_price_diamonds FROM model_profiles WHERE user_id=$1 AND published=true`, [modelId])).rows[0];
      if (!mp) return ack?.({ error: 'model_not_found' });
      if (!mp.accepts_calls) return ack?.({ error: 'calls_disabled' });
      const price = mp.call_price_diamonds || 0;
      const w = (await query(`SELECT diamonds FROM wallets WHERE user_id=$1`, [uid])).rows[0];
      if ((Number(w?.diamonds) || 0) < price) return ack?.({ error: 'insufficient_diamonds', price });
      const call = (await query(
        `INSERT INTO video_calls (caller_id, callee_id, status) VALUES ($1,$2,'ringing') RETURNING id`, [uid, modelId]
      )).rows[0];
      let fromName = 'Un fan';
      try { fromName = (await query(`SELECT display_name FROM profiles WHERE user_id=$1`, [uid])).rows[0]?.display_name || 'Un fan'; } catch {}
      io.to(`user:${modelId}`).emit('private:incoming', { callId: call.id, from: uid, fromName, price });
      ack?.({ ok: true, callId: call.id, price });
    });

    // Solo la MODELO (callee) acepta; se emiten tokens de LiveKit y arranca el cobro.
    socket.on('private:accept', async ({ callId }, ack) => {
      const call = (await query(
        `UPDATE video_calls SET status='active', started_at=now()
           WHERE id=$1 AND callee_id=$2 AND status='ringing' RETURNING caller_id`, [callId, uid]
      )).rows[0];
      if (!call) return ack?.({ error: 'cannot_accept' });
      const viewerId = call.caller_id;
      const room = privateRoomName(uid, viewerId);
      const price = ((await query(`SELECT call_price_diamonds FROM model_profiles WHERE user_id=$1`, [uid])).rows[0]?.call_price_diamonds) || 0;
      const [modelToken, viewerToken] = await Promise.all([
        roomToken({ identity: uid, room, canPublish: true }),
        roomToken({ identity: viewerId, room, canPublish: true }),
      ]);
      io.to(`user:${viewerId}`).emit('private:accepted', { callId, url: config.livekit.url, token: viewerToken, room, price });
      await startPrivateBilling(callId, uid, viewerId, price);
      ack?.({ ok: true, url: config.livekit.url, token: modelToken, room });
    });

    socket.on('private:reject', async ({ callId }, ack) => {
      const c = (await query(
        `UPDATE video_calls SET status='rejected', ended_at=now()
           WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) AND status='ringing'
         RETURNING caller_id, callee_id`, [callId, uid]
      )).rows[0];
      if (c) io.to(`user:${c.caller_id}`).to(`user:${c.callee_id}`).emit('private:rejected', { callId });
      ack?.({ ok: !!c });
    });

    socket.on('private:end', async ({ callId }) => { await endPrivate(callId, 'ended'); });

    // Chat PRIVADO (solo entre los dos participantes de la sala).
    socket.on('private:chat', ({ callId, text }, ack) => {
      const s = privateSessions.get(callId);
      if (!s || (uid !== s.modelId && uid !== s.viewerId)) return ack?.({ error: 'not_in_call' });
      const t = typeof text === 'string' ? text.trim() : '';
      if (t.length < 1 || t.length > 500) return ack?.({ error: 'invalid' });
      io.to(`user:${s.modelId}`).to(`user:${s.viewerId}`).emit('private:chat', { from: uid, text: t, at: Date.now() });
      ack?.({ ok: true });
    });

    // Regalo PRIVADO (el fan incentiva; cobra diamantes y lo ve solo la modelo).
    socket.on('private:gift', async ({ callId, giftId }, ack) => {
      const s = privateSessions.get(callId);
      if (!s || uid !== s.viewerId) return ack?.({ error: 'not_in_call' });
      try {
        const g = await sendGift({ senderId: uid, modelId: s.modelId, giftId, context: 'private', contextId: callId });
        io.to(`user:${s.modelId}`).to(`user:${s.viewerId}`).emit('private:gift', { emoji: g.emoji, name: g.name, cost: g.cost, from: uid, at: Date.now() });
        ack?.({ ok: true, diamonds: g.senderDiamonds });
      } catch (e) { ack?.({ error: e.message || 'gift_failed' }); }
    });

    socket.on('disconnect', async () => {
      await presence.set(uid, 'offline', 5);
      socket.broadcast.emit('presence', { userId: uid, status: 'offline' });
    });
  });

  return io;
}
