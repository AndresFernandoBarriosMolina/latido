import express from 'express';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pinoHttp from 'pino-http';
import { applySecurity } from './middleware/security.js';
import apiRoutes from './routes/index.js';
import { pool, query, withTx } from './config/db.js';
import { signAccess, signRefresh } from './middleware/auth.js';
import { hashPassword } from './services/password.service.js';

const _scrypt = promisify(crypto.scrypt);

export function createApp() {
  const app = express();
  app.use(pinoHttp());
  app.use(express.json({ limit: '1mb' }));
  applySecurity(app);

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now(), build: 'scrypt-b5' }));

  // --- Diagnóstico temporal (quitar tras resolver el cuelgue de register) ---
  app.get('/health/scrypt', async (req, res) => {
    const N = Number(req.query.n) || 16384;
    const t = Date.now();
    try { await _scrypt('password-test', 'saltsalt', 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
      res.json({ ok: true, N, ms: Date.now() - t });
    } catch (e) { res.json({ ok: false, N, ms: Date.now() - t, err: String(e?.message || e) }); }
  });
  app.get('/health/tx', async (_req, res) => {
    const t = Date.now(); let client;
    try { client = await pool.connect();
      await client.query('BEGIN'); await client.query('SELECT 1'); await client.query('COMMIT');
      res.json({ ok: true, ms: Date.now() - t });
    } catch (e) { res.json({ ok: false, ms: Date.now() - t, err: String(e?.message || e) }); }
    finally { if (client) client.release(); }
  });
  // Simula los INSERTs de register (con timeout y ROLLBACK) para ver DÓNDE cuelga.
  app.get('/health/reg', async (_req, res) => {
    const steps = []; let client; let t;
    const mark = (l) => { steps.push({ step: l, ms: Date.now() - t }); t = Date.now(); };
    try {
      client = await pool.connect(); t = Date.now();
      await client.query('BEGIN'); mark('begin');
      await client.query("SET LOCAL statement_timeout = 8000"); mark('set_timeout');
      const em = 'diag-' + Date.now() + '@nope.test';
      const u = (await client.query(
        `INSERT INTO users (role,status,email,phone,birthdate,age_verified,age_verified_at,data_consent_at,tos_version)
         VALUES ('user','active',$1,null,$2,true,now(),now(),'1.0') RETURNING id`, [em, '1990-01-01'])).rows[0];
      mark('insert_users');
      await client.query(`INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)`, [u.id, 'x']); mark('insert_auth');
      await client.query(`INSERT INTO profiles (user_id,display_name) VALUES ($1,$2)`, [u.id, 'Diag']); mark('insert_profile');
      await client.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [u.id]); mark('insert_wallet');
      await client.query('ROLLBACK'); mark('rollback');
      res.json({ ok: true, steps });
    } catch (e) { res.json({ ok: false, steps, err: String(e?.message || e) }); }
    finally { if (client) client.release(); }
  });
  // Replica EXACTA de register (withTx+COMMIT + scrypt + firma JWT) con timing y limpieza.
  app.get('/health/full', async (_req, res) => {
    const steps = []; let t = Date.now(); let uid;
    const mark = (l) => { steps.push({ step: l, ms: Date.now() - t }); t = Date.now(); };
    try {
      const em = 'diagfull-' + Date.now() + '@nope.test';
      const user = await withTx(async (c) => {
        const u = (await c.query(
          `INSERT INTO users (role,status,email,phone,birthdate,age_verified,age_verified_at,data_consent_at,tos_version)
           VALUES ('user','active',$1,null,$2,true,now(),now(),'1.0') RETURNING id, role`, [em, '1990-01-01'])).rows[0];
        const h = await hashPassword('PruebaDiag123456');
        await c.query(`INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)`, [u.id, h]);
        await c.query(`INSERT INTO profiles (user_id,display_name) VALUES ($1,$2)`, [u.id, 'Diag']);
        await c.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [u.id]);
        return u;
      });
      mark('withTx_commit'); uid = user.id;
      const at = signAccess(user); mark('signAccess');
      const rt = signRefresh(user); mark('signRefresh');
      res.json({ ok: true, steps, atLen: at?.length, rtLen: rt?.length });
    } catch (e) { res.json({ ok: false, steps, err: String(e?.message || e) }); }
    finally { if (uid) { try { await query('DELETE FROM users WHERE id=$1', [uid]); } catch {} } }
  });
  // Lista transacciones/locks activos (para detectar una tx atascada que bloquee users).
  app.get('/health/locks', async (_req, res) => {
    try {
      const acts = (await pool.query(
        `SELECT pid, state, wait_event_type AS wtype, wait_event AS wevent,
                extract(epoch from (now()-xact_start))::int AS xact_age_s, left(query,140) AS query
           FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IS NOT NULL
          ORDER BY xact_start NULLS LAST`)).rows;
      res.json({ ok: true, count: acts.length, acts });
    } catch (e) { res.json({ ok: false, err: String(e?.message || e) }); }
  });
  // --------------------------------------------------------------------------

  app.use('/', apiRoutes);

  // Manejador de errores central
  app.use((err, req, res, _next) => {
    req?.log?.error?.(err);
    // Errores de validación Zod -> 400
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'invalid', details: err.flatten() });
    const status = err?.status || 500;
    res.status(status).json({ error: status === 500 ? 'server_error' : (err.message || 'error') });
  });
  return app;
}
