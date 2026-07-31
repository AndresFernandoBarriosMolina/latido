import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../services/password.service.js';
import { query, withTx } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/security.js';
import { signedUploadUrl, publicUrl, uniqueKey, extFromMime, BUCKET_PUBLIC } from '../services/upload.service.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { generateSecret, verifyToken, otpauthUri } from '../services/totp.service.js';

const router = Router();
router.use(authenticate);

// ---------- Mi perfil completo ----------
router.get('/me', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.role, u.status, u.email, u.phone, u.email_verified, u.phone_verified,
              u.birthdate, u.created_at, u.totp_enabled,
              p.display_name, p.bio, p.gender, p.interests, p.city, p.country,
              p.avatar_key, p.is_verified,
              w.diamonds, w.earnings_cop
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN wallets  w ON w.user_id  = u.id
        WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const u = rows[0];
    res.json({
      id: u.id, role: u.role, status: u.status,
      email: u.email, phone: u.phone,
      emailVerified: u.email_verified, phoneVerified: u.phone_verified,
      birthdate: u.birthdate, createdAt: u.created_at,
      displayName: u.display_name, bio: u.bio, gender: u.gender,
      interests: u.interests || [], city: u.city, country: u.country,
      avatarKey: u.avatar_key, avatarUrl: publicUrl(u.avatar_key), isVerified: u.is_verified,
      twoFactorEnabled: u.totp_enabled === true,
      diamonds: Number(u.diamonds || 0), earningsCop: Number(u.earnings_cop || 0),
    });
  } catch (e) { next(e); }
});

// ---------- Editar perfil ----------
const updateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  bio:         z.string().max(400).optional(),
  gender:      z.enum(['male','female','nonbinary','other']).optional(),
  interests:   z.array(z.string().max(40)).max(10).optional(),
  city:        z.string().max(80).optional(),
  country:     z.string().length(2).optional(),
});

router.patch('/me', async (req, res, next) => {
  try {
    const d = updateSchema.parse(req.body);
    const sets = [], vals = [];
    let i = 1;
    if (d.displayName !== undefined) { sets.push(`display_name=$${i++}`); vals.push(d.displayName); }
    if (d.bio         !== undefined) { sets.push(`bio=$${i++}`);          vals.push(d.bio); }
    if (d.gender      !== undefined) { sets.push(`gender=$${i++}`);       vals.push(d.gender); }
    if (d.interests   !== undefined) { sets.push(`interests=$${i++}`);    vals.push(d.interests); }
    if (d.city        !== undefined) { sets.push(`city=$${i++}`);         vals.push(d.city); }
    if (d.country     !== undefined) { sets.push(`country=$${i++}`);      vals.push(d.country); }

    if (!sets.length) return res.json({ ok: true });
    vals.push(req.user.id);
    await query(`UPDATE profiles SET ${sets.join(',')} WHERE user_id=$${i}`, vals);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Cambiar contraseña ----------
const pwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(10),
});

router.post('/me/password', strictLimiter, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = pwSchema.parse(req.body);
    const { rows } = await query(
      `SELECT id, password_hash FROM auth_identities WHERE user_id=$1 AND provider='password'`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'no_password_auth' });
    if (!(await verifyPassword(rows[0].password_hash, currentPassword)))
      return res.status(401).json({ error: 'bad_credentials' });

    const newHash = await hashPassword(newPassword);
    await withTx(async (c) => {
      await c.query(`UPDATE auth_identities SET password_hash=$1 WHERE id=$2`, [newHash, rows[0].id]);
      await c.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.user.id]);
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Notificaciones ----------
router.get('/me/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, type, title, body, data, read_at, created_at
         FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 40`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.patch('/me/notifications/:id/read', async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Sesiones activas ----------
router.get('/me/sessions', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, device_label, ip, user_agent, created_at, expires_at
         FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.delete('/me/sessions/:id', async (req, res, next) => {
  try {
    await query(
      `UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Avatar: URL de subida presignada ----------
router.get('/me/avatar-upload-url', async (req, res, next) => {
  try {
    const { contentType = 'image/jpeg' } = req.query;
    const allowed = ['image/jpeg','image/png','image/webp'];
    if (!allowed.includes(contentType)) return res.status(400).json({ error: 'invalid_content_type' });
    const ext = extFromMime(contentType);
    const key = uniqueKey(`avatars/${req.user.id}`, ext);
    const url = await signedUploadUrl({ bucket: BUCKET_PUBLIC, key, contentType, maxBytes: 5_000_000 });
    res.json({ url, key });
  } catch (e) { next(e); }
});

// Confirmar avatar tras subida exitosa a MinIO
router.patch('/me/avatar', async (req, res, next) => {
  try {
    const { avatarKey } = z.object({ avatarKey: z.string().min(5).max(300) }).parse(req.body);
    // El key DEBE pertenecer al prefijo del propio usuario. Evita referenciar
    // contenido ajeno (p.ej. original_key de otra modelo) como avatar propio.
    if (!avatarKey.startsWith(`avatars/${req.user.id}/`))
      return res.status(400).json({ error: 'invalid_avatar_key' });
    await query(`UPDATE profiles SET avatar_key=$1 WHERE user_id=$2`, [avatarKey, req.user.id]);
    res.json({ ok: true, avatarUrl: publicUrl(avatarKey) });
  } catch (e) { next(e); }
});

// ---------- Claves E2E (ECDH P-256) ----------
router.post('/me/public-key', async (req, res, next) => {
  try {
    const { jwk, keyVersion = 1 } = z.object({
      jwk: z.record(z.unknown()),
      keyVersion: z.number().int().positive().optional(),
    }).parse(req.body);
    await query(
      `INSERT INTO user_crypto_keys (user_id, public_key_jwk, key_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET public_key_jwk=$2, key_version=$3, created_at=now()`,
      [req.user.id, JSON.stringify(jwk), keyVersion]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/:id/public-key', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT public_key_jwk, key_version FROM user_crypto_keys WHERE user_id=$1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'no_key' });
    res.json({ jwk: rows[0].public_key_jwk, keyVersion: rows[0].key_version });
  } catch (e) { next(e); }
});

// ---------- 2FA (TOTP, app autenticadora) ----------
// Paso 1: generar secreto (queda CIFRADO en reposo, aún NO habilitado).
router.post('/me/2fa/setup', strictLimiter, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT email, phone, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (rows[0]?.totp_enabled) return res.status(409).json({ error: 'already_enabled' });
    const secret = generateSecret();
    await query(`UPDATE users SET totp_secret_enc=$1 WHERE id=$2`, [encrypt(secret), req.user.id]);
    const account = rows[0]?.email || rows[0]?.phone || req.user.id;
    res.json({ secret, otpauthUri: otpauthUri(secret, account) });
  } catch (e) { next(e); }
});

// Paso 2: confirmar con un código válido para activar el 2FA.
router.post('/me/2fa/enable', strictLimiter, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const { rows } = await query(`SELECT totp_secret_enc, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (!rows[0]?.totp_secret_enc) return res.status(400).json({ error: 'setup_required' });
    if (rows[0].totp_enabled) return res.status(409).json({ error: 'already_enabled' });
    const secret = decrypt(rows[0].totp_secret_enc);
    if (!verifyToken(secret, code)) return res.status(401).json({ error: 'invalid_code' });
    await query(`UPDATE users SET totp_enabled=true WHERE id=$1`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Desactivar 2FA: exige contraseña actual + código vigente.
router.post('/me/2fa/disable', strictLimiter, async (req, res, next) => {
  try {
    const { password, code } = z.object({
      password: z.string().min(1),
      code: z.string().regex(/^\d{6}$/),
    }).parse(req.body);
    const auth = (await query(
      `SELECT password_hash FROM auth_identities WHERE user_id=$1 AND provider='password'`, [req.user.id]
    )).rows[0];
    if (!auth || !(await verifyPassword(auth.password_hash, password)))
      return res.status(401).json({ error: 'bad_credentials' });
    const u = (await query(`SELECT totp_secret_enc, totp_enabled FROM users WHERE id=$1`, [req.user.id])).rows[0];
    if (!u?.totp_enabled) return res.status(400).json({ error: 'not_enabled' });
    if (!verifyToken(decrypt(u.totp_secret_enc), code)) return res.status(401).json({ error: 'invalid_code' });
    await query(`UPDATE users SET totp_enabled=false, totp_secret_enc=NULL WHERE id=$1`, [req.user.id]);
    await query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Cierre de cuenta ----------
const closeSchema = z.object({
  reason: z.string().min(5).max(1000),
  confirm: z.literal(true),
});

router.post('/me/close-account', strictLimiter, async (req, res, next) => {
  try {
    const { reason } = closeSchema.parse(req.body);
    await withTx(async (c) => {
      await c.query(
        `INSERT INTO deletion_requests (user_id, reason)
         VALUES ($1, $2)
         ON CONFLICT (user_id) WHERE cancelled_at IS NULL AND processed_at IS NULL
         DO NOTHING`,
        [req.user.id, reason]
      );
      await c.query(
        `UPDATE users SET status='pending_deletion' WHERE id=$1 AND status='active'`,
        [req.user.id]
      );
    });
    res.json({ ok: true, scheduledAt: new Date(Date.now() + 15 * 86400_000).toISOString() });
  } catch (e) { next(e); }
});

router.delete('/me/close-account', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE deletion_requests
          SET cancelled_at = now()
        WHERE user_id=$1 AND cancelled_at IS NULL AND processed_at IS NULL
          AND scheduled_deletion_at > now()`,
      [req.user.id]
    );
    if (!rowCount) return res.status(400).json({ error: 'no_pending_request_or_expired' });
    await query(`UPDATE users SET status='active' WHERE id=$1`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
