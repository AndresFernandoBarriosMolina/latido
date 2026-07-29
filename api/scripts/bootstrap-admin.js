// Crea/actualiza la contraseña del admin inicial.
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/bootstrap-admin.js
import { hash as argonHash } from '@node-rs/argon2';
import { query } from '../src/config/db.js';

const email = process.env.ADMIN_EMAIL || 'admin@latido.co';
const password = process.env.ADMIN_PASSWORD;
if (!password) { console.error('Define ADMIN_PASSWORD'); process.exit(1); }

const u = (await query(`SELECT id FROM users WHERE email=$1 AND role='admin'`, [email])).rows[0];
if (!u) { console.error('No existe admin con ese email (revisa el seed).'); process.exit(1); }

const hash = await argonHash(password);
await query(
  `INSERT INTO auth_identities (user_id,provider,password_hash) VALUES ($1,'password',$2)
   ON CONFLICT (provider,provider_uid) DO NOTHING`,
  [u.id, hash]
);
// Si ya existía una identidad password sin provider_uid, actualizarla:
await query(
  `UPDATE auth_identities SET password_hash=$1 WHERE user_id=$2 AND provider='password'`,
  [hash, u.id]
);
console.log('Admin listo:', email);
process.exit(0);
