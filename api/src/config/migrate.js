import { query } from './db.js';

// Migraciones idempotentes que corren en cada arranque del API. Permiten
// evolucionar el esquema de producción (Coolify) sin depender de db-init
// (que solo carga el esquema completo cuando la BD está vacía).
const STATEMENTS = [
  // ---- Socios (partners) ----
  `CREATE TABLE IF NOT EXISTS partners (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     name varchar(120) NOT NULL,
     email varchar(160),
     document varchar(40),
     share_bps integer NOT NULL DEFAULT 0,          -- peso relativo en el pool de socios
     is_active boolean NOT NULL DEFAULT true,
     balance_cop bigint NOT NULL DEFAULT 0,          -- saldo acumulado por consignar
     notes text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // ---- Eventos de reparto (auditoría inmutable de cada consignación) ----
  `CREATE TABLE IF NOT EXISTS revenue_events (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     source varchar(20) NOT NULL,                    -- gift | subscription | private_call
     ref_type varchar(20),
     ref_id uuid,
     model_id uuid,
     gross_cop bigint NOT NULL,                       -- bruto (lo que paga el fan)
     model_cop bigint NOT NULL,                       -- parte de la modelo
     platform_cop bigint NOT NULL,                    -- restante (bruto - modelo)
     admin_cop bigint NOT NULL,                       -- parte del administrador (sostenibilidad)
     partners_cop bigint NOT NULL,                    -- total repartido a socios
     meta jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // ---- Ledger por socio (detalle de cada crédito) ----
  `CREATE TABLE IF NOT EXISTS partner_ledger (
     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     partner_id uuid NOT NULL,
     event_id uuid,
     amount_cop bigint NOT NULL,
     balance_cop bigint NOT NULL,
     memo text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_events_created ON revenue_events(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_events_source ON revenue_events(source)`,
  `CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner ON partner_ledger(partner_id, created_at DESC)`,
  // ---- Cuenta de acceso del socio (portal /socio) ----
  `ALTER TABLE partners ADD COLUMN IF NOT EXISTS user_id uuid`,
  // ---- Eliminación/anonimización de cuenta (PQRS / Habeas Data) ----
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
];

export async function runMigrations() {
  // El rol 'partner' se agrega aparte (ADD VALUE tiene reglas propias) y de forma tolerante.
  try { await query(`ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'partner'`); }
  catch (e) { console.warn('enum partner:', e.message); }
  for (const sql of STATEMENTS) {
    await query(sql);
  }
  console.log(`Migraciones aplicadas (${STATEMENTS.length} sentencias + rol partner)`);
}
