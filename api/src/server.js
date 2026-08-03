import http from 'node:http';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { config, validateConfig } from './config/index.js';
import { initBuckets } from './services/upload.service.js';
import { runMigrations } from './config/migrate.js';
import { seedDefaults, startSettingsRefresh } from './services/settings.service.js';

// Red de seguridad: una rejección/excepción no capturada en un handler NO debe
// tumbar todo el servidor (antes, un hash malformado en /login lo mataba).
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

// Falla rápido si falta configuración crítica (secretos, DB, Redis, S3).
validateConfig();

const app = createApp();
const server = http.createServer(app);
initSockets(server);

initBuckets().catch(e => console.warn('MinIO bucket init:', e.message));

// Migraciones idempotentes + siembra de configuración (no bloquean el arranque).
(async () => {
  try {
    await runMigrations();
    await seedDefaults();
    startSettingsRefresh();
  } catch (e) {
    console.error('boot (migrate/seed) error:', e.message);
  }
})();

server.listen(config.port, () => {
  console.log(`Latido API escuchando en :${config.port} (${config.env})`);
});

// Apagado ordenado
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
