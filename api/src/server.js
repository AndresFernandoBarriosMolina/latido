import http from 'node:http';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { config, validateConfig } from './config/index.js';
import { initBuckets } from './services/upload.service.js';

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

server.listen(config.port, () => {
  console.log(`Latido API escuchando en :${config.port} (${config.env})`);
});

// Apagado ordenado
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
