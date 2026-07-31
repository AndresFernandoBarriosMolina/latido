import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Hashing de contraseñas con scrypt (integrado en Node, SIN módulo nativo).
// Motivo: @node-rs/argon2 (binario nativo) se cuelga en la CPU del VPS de
// producción. scrypt no tiene ese problema y es un KDF fuerte y estándar.
// Formato almacenado: "scrypt$<saltHex>$<hashHex>".
const scryptAsync = promisify(crypto.scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scryptAsync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verifyPassword(stored, password) {
  if (!stored || typeof stored !== 'string') return false;
  try {
    if (stored.startsWith('scrypt$')) {
      const parts = stored.split('$');
      const salt = Buffer.from(parts[1], 'hex');
      const expected = Buffer.from(parts[2], 'hex');
      const dk = await scryptAsync(password, salt, expected.length, { N, r, p });
      return expected.length === dk.length && crypto.timingSafeEqual(expected, dk);
    }
    // Compatibilidad: hashes antiguos argon2 (solo entorno local dev; en
    // producción la BD es nueva y no tiene cuentas argon).
    if (stored.startsWith('$argon2')) {
      const { verify } = await import('@node-rs/argon2');
      return await verify(stored, password);
    }
    return false;
  } catch { return false; }
}
