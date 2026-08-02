import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { config } from '../config/index.js';

export function applySecurity(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  app.use(cors({
    origin: config.security.corsOrigins,
    credentials: true,
  }));

  // Rate limit global respaldado en Redis (mitiga abuso/scraping)
  app.use(rateLimit({
    windowMs: config.security.rateWindow * 1000,
    max: config.security.rateMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  }));
}

// Rate limit estricto para endpoints sensibles (login, OTP, pagos)
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,                       // 10 era muy bajo: al reintentar login tras perder sesión se bloqueaba
  standardHeaders: true,
  legacyHeaders: false,
  // Responder JSON (antes enviaba texto "Too many requests" → el front no lo parseaba y mostraba error genérico).
  handler: (req, res) => res.status(429).json({ error: 'rate_limited', retryAfter: 60 }),
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
});

// ============================================================================
//  Bloqueo de cuenta por fuerza bruta (independiente del rate limit por IP).
//  Cuenta fallos por identificador (email/teléfono) y por IP; al superar el
//  umbral, bloquea temporalmente aunque rote la IP o el identificador.
// ============================================================================
const lockKey = (scope, val) => `loginlock:${scope}:${val}`;

export async function isLoginLocked(identifier, ip) {
  const max = config.security.loginMaxFails;      // umbral por CUENTA (protege una cuenta concreta)
  // Umbral por IP MUCHO más alto: antes bastaban 8 fallos de UNA cuenta para
  // bloquear toda la IP, dejando fuera a usuarios legítimos que comparten
  // red/NAT (oficina, hogar). El bloqueo por IP ahora solo frena ataques
  // distribuidos (muchas cuentas fallando desde una misma IP).
  const ipMax = Math.max(40, max * 5);
  const [byId, byIp] = await redis.mget(lockKey('id', identifier), lockKey('ip', ip));
  const idLocked = Number(byId) >= max;
  const ipLocked = Number(byIp) >= ipMax;
  if (idLocked || ipLocked) {
    const ttl = Math.max(
      idLocked ? await redis.ttl(lockKey('id', identifier)) : 0,
      ipLocked ? await redis.ttl(lockKey('ip', ip)) : 0
    );
    return { locked: true, retryAfter: ttl > 0 ? ttl : config.security.loginLockSeconds };
  }
  return { locked: false };
}

export async function recordLoginFail(identifier, ip) {
  const ttl = config.security.loginLockSeconds;
  const p = redis.multi();
  p.incr(lockKey('id', identifier)).expire(lockKey('id', identifier), ttl);
  p.incr(lockKey('ip', ip)).expire(lockKey('ip', ip), ttl);
  await p.exec();
}

export async function clearLoginFails(identifier, ip) {
  await redis.del(lockKey('id', identifier), lockKey('ip', ip));
}
