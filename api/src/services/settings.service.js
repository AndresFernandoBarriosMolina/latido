import { query } from '../config/db.js';

// ============================================================================
//  Configuración del sistema (system_settings). Los valores se cachean en
//  memoria para poder leerlos de forma SÍNCRONA desde la lógica de dinero
//  (regalos/privado/suscripción) sin await por transacción. Se refresca en
//  segundo plano y al escribir desde el panel admin.
// ============================================================================

// Defaults + descripción. Solo se insertan si la clave no existe (no pisa cambios del admin).
export const SETTING_DEFAULTS = {
  model_revenue_share_bps: { value: 7000, description: '% que recibe la modelo de su producción (bps; 7000 = 70%). Override por modelo en su perfil.' },
  admin_share_bps:         { value: 500,  description: '% para el administrador (sostenibilidad) sobre el RESTANTE tras pagar a la modelo (bps; 500 = 5%).' },
  diamond_price_cop:       { value: 20,   description: 'Valor en COP de 1 diamante (para acreditar ingresos de regalos/privados).' },
  min_payout_cop:          { value: 50000, description: 'Monto mínimo (COP) para que una modelo solicite retiro (payout).' },
  payout_fee_bps:          { value: 0,    description: 'Comisión de procesamiento del retiro (bps sobre el monto).' },
  payout_fee_fixed_cop:    { value: 0,    description: 'Comisión fija por retiro (COP).' },
  tax_withholding_bps:     { value: 0,    description: 'Retención de impuestos aplicada al retiro (bps).' },
  signup_bonus_diamonds:   { value: 0,    description: 'Diamantes de regalo al registrarse un fan nuevo.' },
  min_call_price_diamonds: { value: 0,    description: 'Precio mínimo por minuto de sala privada (💎).' },
  max_call_price_diamonds: { value: 100000, description: 'Precio máximo por minuto de sala privada (💎).' },
  roulette_preview_seconds: { value: 20,  description: 'Ruleta: segundos de vistazo GRATIS con cada modelo antes de empezar a cobrar por minuto.' },
  roulette_price_diamonds: { value: 10,   description: 'Ruleta: precio por minuto (💎) si la modelo no tiene precio propio de llamada.' },
  platform_name:           { value: 'Latido - CamStudio', description: 'Nombre/marca del sitio.' },
  support_email:           { value: '', description: 'Correo de soporte/contacto mostrado a usuarios.' },
};

let cache = {};

export async function loadSettings() {
  try {
    const { rows } = await query('SELECT key, value FROM system_settings');
    const next = {};
    for (const r of rows) next[r.key] = r.value;   // value es jsonb → ya viene parseado
    cache = next;
  } catch (e) {
    // Si falla (arranque temprano), mantenemos el cache previo/defaults.
    console.warn('loadSettings:', e.message);
  }
  return cache;
}

// Feature flags por defecto (se crean apagados si no existen).
export const FLAG_DEFAULTS = {
  admin_ghost_join: 'Permite al admin entrar INVISIBLE a videollamadas para probar conexiones (SOLO fase de pruebas). Apagar antes de salir a producción.',
  maintenance_mode: 'Modo mantenimiento: bloquea el acceso público al sitio.',
};

export async function seedDefaults() {
  for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
    await query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(def.value), def.description]
    );
  }
  for (const [key, desc] of Object.entries(FLAG_DEFAULTS)) {
    await query(
      `INSERT INTO feature_flags (key, enabled) VALUES ($1,false)
       ON CONFLICT (key) DO NOTHING`,
      [key]
    ).catch(() => {});
    // Guardamos la descripción como setting espejo para mostrarla en el panel.
    await query(
      `INSERT INTO system_settings (key, value, description) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO NOTHING`,
      [`flag_desc_${key}`, JSON.stringify(desc), 'Descripción del flag ' + key]
    ).catch(() => {});
  }
  await loadSettings();
}

let refreshTimer = null;
export function startSettingsRefresh(ms = 30000) {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => { loadSettings().catch(() => {}); }, ms);
  if (refreshTimer.unref) refreshTimer.unref();
}

// --- Getters tipados (síncronos, desde cache) ---
function rawVal(key) { return cache[key]; }
export function getNum(key, def) { const n = Number(rawVal(key)); return Number.isFinite(n) ? n : def; }
export function getStr(key, def = '') { const v = rawVal(key); return typeof v === 'string' ? v : def; }
export function getBool(key, def = false) { const v = rawVal(key); return typeof v === 'boolean' ? v : def; }
export function allSettings() { return { ...cache }; }
