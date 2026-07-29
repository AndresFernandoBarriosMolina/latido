import crypto from 'node:crypto';

// ============================================================================
//  TOTP (RFC 6238) — 2FA con apps tipo Google Authenticator / Authy.
//  Implementación nativa (HMAC-SHA1, 30 s, 6 dígitos) sin dependencias.
//  El secreto se almacena CIFRADO en reposo (crypto.service) y nunca en claro.
// ============================================================================

const STEP = 30;       // ventana en segundos
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';   // base32 RFC 4648

// Genera un secreto aleatorio en base32 (160 bits → 32 chars).
export function generateSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5)
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

// Verifica un código permitiendo ±1 ventana (tolerancia de reloj). Comparación
// en tiempo constante para no filtrar información por temporización.
export function verifyToken(secret, token, window = 1) {
  if (!secret || !/^\d{6}$/.test(String(token || ''))) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secret, counter + w);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(token));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// URI otpauth:// para generar el QR en el cliente.
export function otpauthUri(secret, account, issuer = 'Latido') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
