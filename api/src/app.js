import express from 'express';
import pinoHttp from 'pino-http';
import { applySecurity } from './middleware/security.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();
  app.use(pinoHttp());
  app.use(express.json({ limit: '1mb' }));
  applySecurity(app);

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
