import express from 'express';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pinoHttp from 'pino-http';
import { applySecurity } from './middleware/security.js';
import apiRoutes from './routes/index.js';
import { pool } from './config/db.js';

const _scrypt = promisify(crypto.scrypt);

export function createApp() {
  const app = express();
  app.use(pinoHttp());
  app.use(express.json({ limit: '1mb' }));
  applySecurity(app);

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now(), build: 'scrypt-b2' }));

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
