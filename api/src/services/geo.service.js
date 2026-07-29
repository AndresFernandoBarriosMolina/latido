import { query } from '../config/db.js';

// ============================================================================
//  Geolocalización del usuario para el geo-bloqueo por país.
//
//  Estrategia por capas (mayor → menor confianza):
//    1) IP → país (producción). Punto de extensión: cuando se despliegue tras
//       un proxy/borde que aporte el país (Cloudflare `cf-ipcountry`, cabecera
//       propia) o una librería GeoIP offline, resuélvelo aquí PRIMERO.
//    2) País declarado en el perfil del usuario (profiles.country).
//
//  En desarrollo las IPs son privadas (127.x/172.x) y (1) no resuelve, por lo
//  que se usa (2). Devuelve ISO-3166-1 alpha-2 en MAYÚSCULAS, o null.
// ============================================================================

// (1) País por IP. Hoy sólo lee cabeceras de borde si existen; si no, null.
export function countryFromIp(req) {
  const h = req?.headers || {};
  const cf = h['cf-ipcountry'] || h['x-country-code'] || h['x-vercel-ip-country'];
  if (cf && typeof cf === 'string' && cf.length === 2 && cf !== 'XX') return cf.toUpperCase();
  return null;
}

// País declarado en el perfil de un usuario (ISO-2 en mayúsculas) o null.
export async function countryOfUser(uid) {
  if (!uid) return null;
  try {
    const r = (await query(`SELECT country FROM profiles WHERE user_id=$1`, [uid])).rows[0];
    const c = r?.country;
    return c ? String(c).trim().toUpperCase() : null;
  } catch { return null; }
}

// País efectivo del solicitante (IP primero, luego perfil).
export async function viewerCountry(req) {
  return countryFromIp(req) || (await countryOfUser(req?.user?.id));
}

// ¿El país `country` está en la lista de bloqueados de la creadora?
export function isCountryBlocked(country, blocked) {
  if (!country || !Array.isArray(blocked) || !blocked.length) return false;
  return blocked.map((c) => String(c).toUpperCase()).includes(country.toUpperCase());
}

// Variante para sockets (sin req): ¿la creadora `modelId` bloquea a `viewerUid`?
export async function modelBlocksUser(modelId, viewerUid) {
  const country = await countryOfUser(viewerUid);
  if (!country) return false;
  try {
    const r = (await query(`SELECT blocked_countries FROM model_profiles WHERE user_id=$1`, [modelId])).rows[0];
    return isCountryBlocked(country, r?.blocked_countries || []);
  } catch { return false; }
}
