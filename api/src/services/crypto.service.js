import crypto from 'node:crypto';
import { config } from '../config/index.js';

// ============================================================================
//  Cifrado de datos en reposo (at-rest) — AES-256-GCM autenticado.
//
//  Uso: mensajes de chat, PII (cuentas de retiro), secretos TOTP.
//  PRINCIPIO: la BD nunca guarda estos datos en claro. Una fuga del dump SQL
//  no revela conversaciones ni datos sensibles sin la DATA_ENCRYPTION_KEY,
//  que vive solo en el entorno del proceso (no en la BD ni en el repo).
//
//  Formato del blob (string ASCII, seguro para columnas TEXT):
//     v1.<iv_b64url>.<authTag_b64url>.<ciphertext_b64url>
//  El prefijo de versión permite rotar de algoritmo/clave en el futuro sin
//  romper los registros antiguos.
// ============================================================================

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;          // nonce recomendado para GCM

// Clave derivada una sola vez desde el hex de 32 bytes (validado en config).
function key() {
  return Buffer.from(config.security.dataEncryptionKey, 'hex');
}

const b64u  = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url');

// Cifra texto plano UTF-8 → blob versionado. Devuelve null si entra null/'' .
export function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${b64u(iv)}.${b64u(tag)}.${b64u(ct)}`;
}

// Descifra un blob versionado → texto plano. Lanza si el blob fue manipulado
// (GCM falla la verificación del tag) o usa una versión desconocida.
export function decrypt(blob) {
  if (blob == null || blob === '') return null;
  const parts = String(blob).split('.');
  if (parts.length !== 4 || parts[0] !== VERSION)
    throw new Error('crypto_blob_invalido');
  const [, ivb, tagb, ctb] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), unb64u(ivb));
  decipher.setAuthTag(unb64u(tagb));
  const pt = Buffer.concat([decipher.update(unb64u(ctb)), decipher.final()]);
  return pt.toString('utf8');
}

// Descifrado tolerante: devuelve un marcador en vez de lanzar (para listados
// donde un registro corrupto no debe tumbar toda la respuesta).
export function decryptSafe(blob, fallback = null) {
  try { return decrypt(blob); } catch { return fallback; }
}

// Hash determinista con clave (HMAC-SHA256) para búsqueda/igualdad sobre datos
// sensibles sin almacenarlos en claro (p.ej. número de documento, índice ciego).
export function blindIndex(value) {
  return crypto.createHmac('sha256', key()).update(String(value)).digest('hex');
}
