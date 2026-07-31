import { Router } from 'express';
import { z } from 'zod';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { query, withTx } from '../config/db.js';
import { signAccess, signRefresh, authenticate } from '../middleware/auth.js';
import { strictLimiter, isLoginLocked, recordLoginFail, clearLoginFails } from '../middleware/security.js';
import { decrypt } from '../services/crypto.service.js';
import { verifyToken } from '../services/totp.service.js';
import { config } from '../config/index.js';

const router = Router();
const google = new OAuth2Client(config.google.clientId);

// Edad mínima 18: util
function isAdult(birthdate) {
  const d = new Date(birthdate);
  const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= 18;
}

const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
  password: z.string().min(10),
  displayName: z.string().min(2).max(80),
  birthdate: z.string(),                 // YYYY-MM-DD
  dataConsent: z.literal(true),          // Habeas Data obligatorio
}).refine(d => d.email || d.phone, { message: 'email_or_phone_required' });

// Registro manual (usuario/fan). El alta de MODELO sigue flujo KYC aparte.
router.post('/register', strictLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', details: parsed.error.flatten() });
  const d = parsed.data;
  if (!isAdult(d.birthdate)) return res.status(403).json({ error: 'underage' });

  try {
    const user = await withTx(async (c) => {
      // status='active': la verificación de email/OTP es una fase posterior aún
      // no implementada; sin ella, dejar al usuario en 'pending' lo haría
      // invisible públicamente (p.ej. perfiles de modelo). El path de Google ya
      // crea usuarios activos, por consistencia se hace igual aquí.
      const u = (await c.query(
        `INSERT INTO users (role,status,email,phone,birthdate,age_verified,age_verified_at,data_consent_at,tos_version)
         VALUES ('user','active',$1,$2,$3,true,now(),now(),'1.0') RETURNING id, role`,
        [d.email || null, d.phone || null, d.birthdate]
      )).rows[0];
      const hash = await argonHash(d.password);
      await c.query(`INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)`, [u.id, hash]);
      await c.query(`INSERT INTO profiles (user_id,display_name) VALUES ($1,$2)`, [u.id, d.displayName]);
      await c.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [u.id]);
      return u;
    });
    res.status(201).json({
      accessToken: signAccess(user),
      refreshToken: signRefresh(user),
    });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'already_exists' });
    throw e;
  }
});

// Login manual
const loginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password:   z.string().min(1).max(200),
  totpCode:   z.string().regex(/^\d{6}$/).optional(),
});

router.post('/login', strictLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid' });
  const { identifier, password, totpCode } = parsed.data;

  // Bloqueo por fuerza bruta (por identificador y por IP).
  const lock = await isLoginLocked(identifier, req.ip);
  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfter));
    return res.status(429).json({ error: 'account_locked', retryAfter: lock.retryAfter });
  }

  const { rows } = await query(
    `SELECT u.id,u.role,u.status,u.totp_enabled,u.totp_secret_enc,ai.password_hash FROM users u
       JOIN auth_identities ai ON ai.user_id=u.id AND ai.provider='password'
      WHERE (u.email=$1 OR u.phone=$1) LIMIT 1`,
    [identifier]
  );
  const rec = rows[0];
  // argonVerify lanza si el hash es NULL/malformado → capturar para NO tumbar el proceso.
  let pwOk = false;
  if (rec && rec.password_hash) {
    try { pwOk = await argonVerify(rec.password_hash, password); } catch { pwOk = false; }
  }
  if (!rec || !pwOk) {
    await recordLoginFail(identifier, req.ip);
    return res.status(401).json({ error: 'bad_credentials' });
  }
  if (rec.status === 'suspended') return res.status(403).json({ error: 'account_suspended' });
  if (rec.status === 'banned') return res.status(403).json({ error: 'account_banned' });

  // Segundo factor (TOTP) si está habilitado.
  if (rec.totp_enabled) {
    if (!totpCode) return res.status(401).json({ error: 'totp_required' });
    let secret = null;
    try { secret = decrypt(rec.totp_secret_enc); } catch { secret = null; }
    if (!secret || !verifyToken(secret, totpCode)) {
      await recordLoginFail(identifier, req.ip);
      return res.status(401).json({ error: 'totp_invalid' });
    }
  }

  await clearLoginFails(identifier, req.ip);
  const accessToken = signAccess(rec);
  const refreshToken = signRefresh(rec);
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await query(
    `INSERT INTO sessions (user_id,refresh_hash,ip,user_agent,expires_at)
     VALUES ($1,$2,$3,$4,now() + ($5 || ' seconds')::interval)`,
    [rec.id, tokenHash, req.ip, req.headers['user-agent'] || null, config.jwt.refreshTtl]
  );
  await query(`UPDATE users SET last_seen_at=now() WHERE id=$1`, [rec.id]);
  res.json({ accessToken, refreshToken });
});

// Login con Google (verifica id_token)
router.post('/google', strictLimiter, async (req, res) => {
  const { idToken, birthdate, dataConsent } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'no_id_token' });
  const ticket = await google.verifyIdToken({ idToken, audience: config.google.clientId });
  const p = ticket.getPayload();

  let { rows } = await query(
    `SELECT u.id,u.role FROM users u JOIN auth_identities ai ON ai.user_id=u.id
      WHERE ai.provider='google' AND ai.provider_uid=$1 LIMIT 1`,
    [p.sub]
  );
  if (!rows[0]) {
    if (!birthdate || !isAdult(birthdate) || dataConsent !== true)
      return res.status(403).json({ error: 'age_and_consent_required' });
    const user = await withTx(async (c) => {
      const u = (await c.query(
        `INSERT INTO users (role,status,email,email_verified,birthdate,age_verified,age_verified_at,data_consent_at,tos_version)
         VALUES ('user','active',$1,true,$2,true,now(),now(),'1.0') RETURNING id, role`,
        [p.email, birthdate]
      )).rows[0];
      await c.query(`INSERT INTO auth_identities (user_id,provider,provider_uid) VALUES ($1,'google',$2)`, [u.id, p.sub]);
      await c.query(`INSERT INTO profiles (user_id,display_name,avatar_key) VALUES ($1,$2,$3)`, [u.id, p.name || 'Usuario', p.picture || null]);
      await c.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [u.id]);
      return u;
    });
    rows = [user];
  }
  res.json({ accessToken: signAccess(rows[0]), refreshToken: signRefresh(rows[0]) });
});

// Refresh access token
router.post('/refresh', strictLimiter, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'no_token' });
  let payload;
  try { payload = jwt.verify(refreshToken, config.jwt.refreshSecret); }
  catch { return res.status(401).json({ error: 'invalid_token' }); }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const { rows } = await query(
    `SELECT s.id, u.id AS uid, u.role, u.status FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id=$1 AND s.refresh_hash=$2
        AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1`,
    [payload.sub, tokenHash]
  );
  if (!rows[0]) return res.status(401).json({ error: 'session_expired' });
  const { uid, role, status } = rows[0];
  if (status === 'suspended') return res.status(403).json({ error: 'account_suspended' });
  if (status === 'banned') return res.status(403).json({ error: 'account_banned' });

  const newRefresh = signRefresh({ id: uid, role });
  const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
  await query(
    `UPDATE sessions SET refresh_hash=$1, expires_at=now() + ($2 || ' seconds')::interval WHERE id=$3`,
    [newHash, config.jwt.refreshTtl, rows[0].id]
  );
  res.json({ accessToken: signAccess({ id: uid, role }), refreshToken: newRefresh });
});

// Logout (revoca sesión)
router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query(
      `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND refresh_hash=$2`,
      [req.user.id, tokenHash]
    );
  } else {
    await query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [req.user.id]);
  }
  res.json({ ok: true });
});

export default router;
