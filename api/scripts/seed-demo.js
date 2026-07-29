// Datos demo de modelos para probar el descubrimiento. Idempotente.
//   docker compose exec api node scripts/seed-demo.js
import { pool, withTx } from '../src/config/db.js';

const demo = [
  { name: 'Valentina', handle: 'valentina', city: 'Medellín',     birth: '1999-03-12', live: true,  interests: ['fitness','viajes'] },
  { name: 'Camila',    handle: 'camila',    city: 'Bogotá',       birth: '2001-07-22', live: false, interests: ['cosplay','música'] },
  { name: 'Mariana',   handle: 'mariana',   city: 'Cali',         birth: '1996-11-02', live: true,  interests: ['baile','arte'] },
  { name: 'Sofía',     handle: 'sofia',     city: 'Medellín',     birth: '2002-01-30', live: false, interests: ['moda','viajes'] },
  { name: 'Daniela',   handle: 'daniela',   city: 'Barranquilla', birth: '1998-05-18', live: false, interests: ['fitness','playa'] },
  { name: 'Luciana',   handle: 'luciana',   city: 'Bogotá',       birth: '2000-09-09', live: false, interests: ['gamer','música'] },
  { name: 'Isabella',  handle: 'isabella',  city: 'Cali',         birth: '1997-12-25', live: true,  interests: ['modelo','arte'] },
  { name: 'Antonia',   handle: 'antonia',   city: 'Medellín',     birth: '2003-04-14', live: false, interests: ['baile','fitness'] },
];

let created = 0;
for (const m of demo) {
  const email = `${m.handle}@demo.latido.co`;
  await withTx(async (c) => {
    const existing = await c.query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing.rows.length) return;

    const u = (await c.query(
      `INSERT INTO users (role,status,email,email_verified,birthdate,age_verified,age_verified_at,data_consent_at,tos_version)
       VALUES ('model','active',$1,true,$2,true,now(),now(),'1.0') RETURNING id`,
      [email, m.birth]
    )).rows[0];

    await c.query(
      `INSERT INTO profiles (user_id,display_name,bio,city,interests,is_verified)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [u.id, m.name, `Creadora de contenido 💋 ${m.interests.join(' · ')}`, m.city, m.interests]
    );
    await c.query(
      `INSERT INTO model_profiles (user_id,handle,headline,monthly_price_cop,is_live,kyc_status,kyc_approved_at,published,rating_avg,rating_count)
       VALUES ($1,$2,$3,24900,$4,'approved',now(),true,4.9,1200)`,
      [u.id, m.handle, `${m.interests[0]} y buenas charlas`, m.live]
    );
    await c.query(`INSERT INTO wallets (user_id) VALUES ($1)`, [u.id]);

    // media: 5 fotos públicas (slider) + 12 fotos suscriptores + 4 videos
    const mk = (i, type, vis) => c.query(
      `INSERT INTO media_assets (model_id,type,status,visibility,original_key,blurred_preview_key,thumbnail_key,published_at,likes_count,views_count)
       VALUES ($1,$2,'published',$3,$4,$5,$6,now(),$7,$8)`,
      [u.id, type, vis,
       `media/${m.handle}/${type}_${i}.bin`,
       `public/${m.handle}/blur_${i}.jpg`,
       `public/${m.handle}/thumb_${i}.jpg`,
       Math.floor(Math.random() * 400), Math.floor(Math.random() * 2000)]
    );
    for (let i = 0; i < 5; i++)  await mk(i, 'photo', 'public');
    for (let i = 0; i < 12; i++) await mk(i + 5, 'photo', 'subscribers');
    for (let i = 0; i < 4; i++)  await mk(i, 'video', 'subscribers');

    created++;
  });
}
console.log(`Modelos demo creados: ${created} (de ${demo.length})`);
await pool.end();
process.exit(0);
