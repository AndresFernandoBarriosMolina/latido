import { query, withTx } from '../config/db.js';
import { encrypt, decryptSafe } from './crypto.service.js';

// ============================================================================
//  Mensajería con cifrado en reposo.
//
//  - El cuerpo de cada mensaje se guarda CIFRADO (AES-256-GCM) en messages.body_enc.
//    La columna legacy `body` (texto plano) se deja en NULL.
//  - Solo los participantes (vía API) o staff en moderación (con registro en
//    audit_log) pueden descifrar.
//  - Se respetan los bloqueos entre usuarios.
// ============================================================================

// Orden canónico del par para respetar UNIQUE(user_a,user_b) sin duplicar
// la conversación según quién escriba primero.
function orderPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function isBlockedBetween(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}

export async function getOrCreateConversation(a, b) {
  const [ua, ub] = orderPair(a, b);
  const { rows } = await query(
    `INSERT INTO conversations (user_a, user_b)
     VALUES ($1, $2)
     ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a
     RETURNING id`,
    [ua, ub]
  );
  return rows[0].id;
}

// Persiste un mensaje cifrado. Devuelve { id, conversationId, createdAt } o
// lanza un error tipado si las partes están bloqueadas.
export async function saveMessage({ fromId, toId, text }) {
  if (await isBlockedBetween(fromId, toId))
    throw Object.assign(new Error('blocked'), { status: 403 });

  const enc = encrypt(text);
  return withTx(async (c) => {
    const [ua, ub] = orderPair(fromId, toId);
    const conv = (await c.query(
      `INSERT INTO conversations (user_a, user_b) VALUES ($1,$2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET last_message_at = now()
       RETURNING id`,
      [ua, ub]
    )).rows[0];
    const msg = (await c.query(
      `INSERT INTO messages (conversation_id, sender_id, body_enc, enc_ver)
       VALUES ($1,$2,$3,1) RETURNING id, created_at`,
      [conv.id, fromId, enc]
    )).rows[0];
    await c.query(`UPDATE conversations SET last_message_at = now() WHERE id=$1`, [conv.id]);
    return { id: msg.id, conversationId: conv.id, createdAt: msg.created_at };
  });
}

// Verifica que el usuario sea participante de la conversación.
async function assertParticipant(conversationId, userId) {
  const { rows } = await query(
    `SELECT id FROM conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)`,
    [conversationId, userId]
  );
  if (!rows[0]) throw Object.assign(new Error('not_found'), { status: 404 });
}

// Lista las conversaciones del usuario con el último mensaje descifrado.
export async function listConversations(userId, { limit = 30 } = {}) {
  const { rows } = await query(
    `SELECT c.id, c.last_message_at,
            CASE WHEN c.user_a=$1 THEN c.user_b ELSE c.user_a END AS other_id,
            p.display_name AS other_name, p.avatar_key AS other_avatar,
            m.body_enc AS last_enc, m.sender_id AS last_sender, m.created_at AS last_at
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT body_enc, sender_id, created_at FROM messages
          WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN profiles p ON p.user_id = (CASE WHEN c.user_a=$1 THEN c.user_b ELSE c.user_a END)
      WHERE c.user_a=$1 OR c.user_b=$1
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    otherId: r.other_id,
    otherName: r.other_name,
    otherAvatar: r.other_avatar,
    lastMessage: r.last_enc ? decryptSafe(r.last_enc, '[mensaje no disponible]') : null,
    lastSender: r.last_sender,
    lastAt: r.last_at,
  }));
}

// Historial descifrado de una conversación, solo para un participante.
export async function listMessages(conversationId, userId, { limit = 50, before } = {}) {
  await assertParticipant(conversationId, userId);
  const params = [conversationId];
  let where = `conversation_id=$1`;
  if (before) { params.push(before); where += ` AND created_at < $${params.length}`; }
  params.push(Math.min(100, limit));
  const { rows } = await query(
    `SELECT id, sender_id, body_enc, created_at, read_at, is_ppv, media_id
       FROM messages WHERE ${where}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  // Marca como leídos los mensajes recibidos.
  await query(
    `UPDATE messages SET read_at=now()
      WHERE conversation_id=$1 AND sender_id<>$2 AND read_at IS NULL`,
    [conversationId, userId]
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    message: decryptSafe(r.body_enc, '[mensaje no disponible]'),
    createdAt: r.created_at,
    readAt: r.read_at,
    isPpv: r.is_ppv,
    mediaId: r.media_id,
  }));
}

// Lectura de MODERACIÓN: descifra todos los mensajes de una conversación.
// El llamador (admin/moderador) DEBE registrar el acceso en audit_log.
export async function moderationReadMessages(conversationId, { limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT id, sender_id, body_enc, created_at FROM messages
      WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT $2`,
    [conversationId, Math.min(1000, limit)]
  );
  return rows.map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    message: decryptSafe(r.body_enc, '[no descifrable]'),
    createdAt: r.created_at,
  }));
}
