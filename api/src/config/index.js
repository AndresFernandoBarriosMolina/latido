import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.API_PORT || 4000),
  publicUrl: process.env.PUBLIC_URL,

  db: { url: process.env.DATABASE_URL },
  redis: { url: process.env.REDIS_URL },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    // OJO: Number(x) || def, NO Number(x || def). Si la env trae un valor no
    // numérico ("15m", "900s"), Number(x||def) daría NaN y jwt.sign LANZA
    // ("expiresIn should be a number..."), colgando register/login (throw en
    // handler async no capturado). Con Number(x)||def, NaN cae al default.
    accessTtl: Number(process.env.JWT_ACCESS_TTL) || 900,
    refreshTtl: Number(process.env.JWT_REFRESH_TTL) || 2592000,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },

  wompi: {
    publicKey: process.env.WOMPI_PUBLIC_KEY,
    privateKey: process.env.WOMPI_PRIVATE_KEY,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET,
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET,
    mode: process.env.WOMPI_MODE || 'sandbox',          // sandbox | production
    // URL del Web Checkout (redirección). Misma para sandbox/prod; las llaves
    // (pub_test_/pub_prod_) determinan el entorno.
    checkoutUrl: process.env.WOMPI_CHECKOUT_URL || 'https://checkout.wompi.co/p/',
    currency: 'COP',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT,                 // interno (servidor → minio)
    // Endpoint PÚBLICO usado para firmar URLs que el NAVEGADOR debe alcanzar.
    // El navegador no resuelve "minio:9000"; debe apuntar a nginx (que proxea
    // /latido-media/ y /latido-public/ a MinIO preservando el Host firmado).
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    bucketMedia: process.env.S3_BUCKET_MEDIA,
    bucketPublic: process.env.S3_BUCKET_PUBLIC,
    signedTtl: Number(process.env.MEDIA_SIGNED_URL_TTL || 45),
  },

  turn: {
    realm: process.env.TURN_REALM,
    secret: process.env.TURN_SECRET,
    urls: (process.env.TURN_URLS || '').split(',').filter(Boolean),
  },

  livekit: {
    // URL que usa el NAVEGADOR para conectarse al SFU (ws en dev, wss en prod).
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  },

  // Valor en COP de 1 diamante (para acreditar ingresos de regalos/privados).
  diamondCop: Number(process.env.DIAMOND_COP || 20),

  kyc: {
    provider: process.env.KYC_PROVIDER || '',          // truora|sumsub|metamap… (vacío = sin proveedor)
    apiKey: process.env.KYC_API_KEY || '',
    webhookSecret: process.env.KYC_WEBHOOK_SECRET || '',
    // Aprobación automática por reglas cuando NO hay proveedor (interino). En
    // producción, configurar un proveedor para verificación real (OCR+vida+match).
    autoApprove: process.env.KYC_AUTO_APPROVE !== 'false',
    faceMatchMin: Number(process.env.KYC_FACE_MATCH_MIN || 0.85),
  },

  security: {
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
    rateWindow: Number(process.env.RATE_LIMIT_WINDOW || 60),
    rateMax: Number(process.env.RATE_LIMIT_MAX || 120),
    watermarkSalt: process.env.WATERMARK_SALT,
    // Clave maestra de cifrado en reposo (hex de 32 bytes) para mensajes, PII y TOTP.
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY,
    // Versión vigente del consentimiento de publicación (cumplimiento 2257 / Ley 1581).
    contentConsentVersion: process.env.CONTENT_CONSENT_VERSION || '1.0',
    // Bloqueo de fuerza bruta en login.
    loginMaxFails: Number(process.env.LOGIN_MAX_FAILS || 8),
    loginLockSeconds: Number(process.env.LOGIN_LOCK_SECONDS || 900),
  },
};

// ============================================================================
//  Validación de configuración crítica al arranque ("fail fast").
//  Sin esto, un secreto JWT vacío arrancaría sin error y jsonwebtoken
//  aceptaría como válido cualquier token firmado con "".
// ============================================================================
export function validateConfig() {
  const errors = [];
  const requireStr = (name, val, minLen = 1) => {
    if (typeof val !== 'string' || val.length < minLen)
      errors.push(`${name} ausente o demasiado corto (mínimo ${minLen} caracteres)`);
  };

  requireStr('JWT_ACCESS_SECRET',  config.jwt.accessSecret,  32);
  requireStr('JWT_REFRESH_SECRET', config.jwt.refreshSecret, 32);
  requireStr('DATABASE_URL',       config.db.url);
  requireStr('REDIS_URL',          config.redis.url);
  requireStr('S3_ACCESS_KEY',      config.s3.accessKey);
  requireStr('S3_SECRET_KEY',      config.s3.secretKey);

  // Clave de cifrado en reposo: exactamente 32 bytes en hex (64 chars). Sin esto,
  // mensajes/PII no podrían cifrarse y arrancar sería inseguro.
  const dek = config.security.dataEncryptionKey;
  if (typeof dek !== 'string' || !/^[0-9a-fA-F]{64}$/.test(dek))
    errors.push('DATA_ENCRYPTION_KEY debe ser hex de 32 bytes (64 caracteres). Generar con: openssl rand -hex 32');
  if (dek && (dek === config.jwt.accessSecret || dek === config.jwt.refreshSecret))
    errors.push('DATA_ENCRYPTION_KEY no debe reutilizar un secreto JWT');

  if (config.jwt.accessSecret && config.jwt.accessSecret === config.jwt.refreshSecret)
    errors.push('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET no deben ser iguales');

  // En producción, los orígenes CORS deben existir y ser HTTPS (cubre LAT-011).
  if (config.env === 'production') {
    if (!config.security.corsOrigins.length)
      errors.push('CORS_ORIGINS vacío en producción');
    for (const o of config.security.corsOrigins)
      if (!o.startsWith('https://'))
        errors.push(`CORS origin no-HTTPS en producción: ${o}`);
  }

  if (errors.length) {
    console.error('\n❌ Configuración inválida — el servidor no puede arrancar:');
    for (const e of errors) console.error('   -', e);
    console.error('');
    process.exit(1);
  }
}
