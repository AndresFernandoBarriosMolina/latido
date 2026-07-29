/**
 * Activa login con contraseña para valentina@demo.latido.co
 * Uso: docker compose exec api node scripts/seed-model.js
 */
import { hash as argonHash } from '@node-rs/argon2';
import { query, pool } from '../src/config/db.js';

const EMAIL    = 'valentina@demo.latido.co';
const PASSWORD = 'Modelo2024!';

async function main() {
  const { rows } = await query(
    `SELECT u.id, u.role, p.display_name
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.email = $1`,
    [EMAIL]
  );

  if (!rows[0]) {
    console.error(`Usuario ${EMAIL} no encontrado. Ejecuta primero: node scripts/seed-demo.js`);
    process.exit(1);
  }

  const { id, role, display_name } = rows[0];
  console.log(`Usuario encontrado: ${display_name} (${id}) — rol: ${role}`);

  const hash = await argonHash(PASSWORD);

  await query(
    `INSERT INTO auth_identities (user_id, provider, provider_uid, password_hash)
     VALUES ($1, 'password', $2, $3)
     ON CONFLICT (provider, provider_uid)
     DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [id, EMAIL, hash]
  );

  // Asegura que el modelo esté activo y publicado
  await query(`UPDATE users SET status='active' WHERE id=$1`, [id]);
  await query(`UPDATE model_profiles SET published=true WHERE user_id=$1`, [id]);

  console.log(`\n✓ Credenciales listas:`);
  console.log(`  Email    : ${EMAIL}`);
  console.log(`  Password : ${PASSWORD}`);
  console.log(`  Rol      : ${role}`);
  console.log(`\nPuedes iniciar sesión en https://localhost`);

  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
