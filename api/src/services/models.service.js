import { query, withTx } from '../config/db.js';
import { presence } from '../config/redis.js';
import { publicUrl, signedReadUrl, BUCKET_MEDIA } from './upload.service.js';

// Estado mostrado: en vivo > presencia en tiempo real
function deriveStatus(isLive, pres) {
  if (isLive) return 'live';
  return pres; // 'online' | 'in_call' | 'away' | 'offline'
}

// Imagen de tarjeta (descubrimiento/en vivo): avatar → si no, foto de vitrina.
async function cardImageUrl(avatarKey, showcaseKey) {
  if (avatarKey) return publicUrl(avatarKey);
  if (showcaseKey) { try { return await signedReadUrl(showcaseKey, BUCKET_MEDIA, 600); } catch { return null; } }
  return null;
}

// ---------------------------------------------------------------------------
//  Descubrimiento: lista de modelos con filtros + búsqueda dinámica
//  filter: 'all' | 'live' | 'online' | 'new' | 'near'
// ---------------------------------------------------------------------------
export async function listModels({ q = '', filter = 'all', lat, lng, limit = 24, offset = 0, viewerCountry = null }) {
  const params = [q];
  let where = `WHERE u.role='model' AND u.status='active' AND mp.published = true`;

  // Búsqueda por nombre, ciudad o intereses
  where += ` AND ($1 = '' OR p.display_name ILIKE '%'||$1||'%' OR p.city ILIKE '%'||$1||'%'
              OR EXISTS (SELECT 1 FROM unnest(p.interests) it WHERE it ILIKE '%'||$1||'%'))`;

  if (filter === 'live') where += ` AND mp.is_live = true`;
  if (filter === 'new')  where += ` AND mp.created_at > now() - interval '14 days'`;

  // "Cerca de ti" con PostGIS si llegan coordenadas
  let orderGeo = '';
  if (filter === 'near' && lat != null && lng != null) {
    params.push(lng, lat);
    where += ` AND p.geo IS NOT NULL`;
    orderGeo = `ST_Distance(p.geo, ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}),4326)::geography) ASC,`;
  }

  // Geo-bloqueo: excluir creadoras que bloquean el país del solicitante.
  let geoBlock = '';
  if (viewerCountry) {
    params.push(viewerCountry);
    geoBlock = ` AND NOT (COALESCE(mp.blocked_countries,'{}') @> ARRAY[$${params.length}]::text[])`;
  }

  params.push(limit, offset);
  const sql = `
    SELECT u.id, mp.handle, p.display_name, p.city, p.avatar_key,
           date_part('year', age(u.birthdate))::int AS age,
           mp.is_live, p.is_verified, mp.monthly_price_cop, mp.rating_avg,
           EXISTS (SELECT 1 FROM media_assets m
                     WHERE m.model_id = u.id AND m.visibility IN ('subscribers','ppv')
                       AND m.status='published') AS has_premium,
           (SELECT COALESCE(m2.thumbnail_key, m2.original_key) FROM media_assets m2
              WHERE m2.model_id = u.id AND m2.type='photo' AND m2.visibility='public'
                AND m2.status='published'
              ORDER BY m2.published_at DESC NULLS LAST LIMIT 1) AS showcase_key
      FROM users u
      JOIN model_profiles mp ON mp.user_id = u.id
      JOIN profiles p        ON p.user_id  = u.id
      ${where}${geoBlock}
      ORDER BY ${orderGeo} mp.is_live DESC, mp.rating_avg DESC NULLS LAST, mp.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);

  // Presencia en tiempo real desde Redis (una sola consulta)
  const pres = await presence.mget(rows.map((r) => r.id));
  let items = await Promise.all(rows.map(async (r) => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    age: r.age,
    city: r.city,
    avatar: r.avatar_key,
    photoUrl: await cardImageUrl(r.avatar_key, r.showcase_key),
    verified: r.is_verified,
    isLive: r.is_live,
    status: deriveStatus(r.is_live, pres[r.id]),
    hasPremium: r.has_premium,
    monthlyPriceCop: Number(r.monthly_price_cop),
    rating: r.rating_avg ? Number(r.rating_avg) : null,
  })));

  // El filtro 'online' depende de presencia (Redis), se aplica tras la consulta
  if (filter === 'online') items = items.filter((m) => m.status === 'online' || m.status === 'live');

  return items;
}

// ---------------------------------------------------------------------------
//  Perfil público de una modelo (sin contenido premium)
// ---------------------------------------------------------------------------
export async function getModelByHandle(handle) {
  const { rows } = await query(
    `SELECT u.id, mp.handle, p.display_name, p.bio, p.city, p.interests, p.avatar_key,
            date_part('year', age(u.birthdate))::int AS age,
            mp.headline, mp.cover_key, mp.is_live, p.is_verified,
            mp.monthly_price_cop, mp.rating_avg, mp.rating_count, mp.accepts_calls,
            mp.blocked_countries
       FROM users u
       JOIN model_profiles mp ON mp.user_id = u.id
       JOIN profiles p        ON p.user_id  = u.id
      WHERE mp.handle = $1 AND mp.published = true AND u.status='active'`,
    [handle]
  );
  const m = rows[0];
  if (!m) return null;

  const [counts, photos, pres] = await Promise.all([
    query(
      `SELECT
         count(*) FILTER (WHERE type='photo')::int AS photos,
         count(*) FILTER (WHERE type='video')::int AS videos,
         COALESCE(sum(likes_count),0)::int AS likes
       FROM media_assets WHERE model_id=$1 AND status='published'`,
      [m.id]
    ),
    // Fotos PÚBLICAS para el slider (no premium)
    query(
      `SELECT id, thumbnail_key FROM media_assets
        WHERE model_id=$1 AND type='photo' AND visibility='public' AND status='published'
        ORDER BY published_at DESC LIMIT 6`,
      [m.id]
    ),
    presence.get(m.id),
  ]);

  return {
    id: m.id,
    handle: m.handle,
    displayName: m.display_name,
    age: m.age,
    city: m.city,
    bio: m.bio,
    headline: m.headline,
    interests: m.interests || [],
    avatar: m.avatar_key,
    cover: m.cover_key,
    verified: m.is_verified,
    isLive: m.is_live,
    status: deriveStatus(m.is_live, pres),
    acceptsCalls: m.accepts_calls,
    monthlyPriceCop: Number(m.monthly_price_cop),
    rating: m.rating_avg ? Number(m.rating_avg) : null,
    ratingCount: m.rating_count,
    blockedCountries: m.blocked_countries || [],
    stats: {
      photos: counts.rows[0].photos,
      videos: counts.rows[0].videos,
      likes: counts.rows[0].likes,
    },
    sliderPhotos: photos.rows.map((r) => ({ id: r.id, thumb: r.thumbnail_key })),
  };
}

// ---------------------------------------------------------------------------
//  Convertirse en modelo (queda no publicada hasta aprobar KYC)
// ---------------------------------------------------------------------------
export async function becomeModel(userId, { handle, headline, monthlyPriceCop }) {
  return withTx(async (c) => {
    const exists = await c.query(`SELECT 1 FROM model_profiles WHERE handle=$1`, [handle]);
    if (exists.rows.length) { const e = new Error('handle_taken'); e.status = 409; throw e; }

    await c.query(`UPDATE users SET role='model' WHERE id=$1 AND role='user'`, [userId]);
    await c.query(
      `INSERT INTO model_profiles (user_id, handle, headline, monthly_price_cop, published)
       VALUES ($1,$2,$3,COALESCE($4,24900), false)
       ON CONFLICT (user_id) DO UPDATE SET handle=EXCLUDED.handle, headline=EXCLUDED.headline`,
      [userId, handle, headline || null, monthlyPriceCop || null]
    );
    return { handle, published: false, kycRequired: true };
  });
}

// Ajustes propios de la creadora (para su consola).
export async function getModelSettings(userId) {
  const r = (await query(
    `SELECT handle, headline, monthly_price_cop, accepts_calls, call_price_diamonds, blocked_countries
       FROM model_profiles WHERE user_id=$1`, [userId]
  )).rows[0];
  if (!r) return null;
  return {
    handle: r.handle,
    headline: r.headline,
    monthlyPriceCop: Number(r.monthly_price_cop || 0),
    acceptsCalls: r.accepts_calls,
    callPriceDiamonds: r.call_price_diamonds || 0,
    blockedCountries: r.blocked_countries || [],
  };
}

export async function updateModelProfile(userId, data) {
  const fields = [];
  const params = [];
  const map = { headline: 'headline', monthlyPriceCop: 'monthly_price_cop', acceptsCalls: 'accepts_calls', callPriceDiamonds: 'call_price_diamonds' };
  for (const [k, col] of Object.entries(map)) {
    if (data[k] !== undefined) { params.push(data[k]); fields.push(`${col}=$${params.length}`); }
  }
  // Países bloqueados (ISO-2 en mayúsculas). Se guarda como text[].
  if (data.blockedCountries !== undefined) {
    const list = Array.isArray(data.blockedCountries)
      ? [...new Set(data.blockedCountries.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))]
      : [];
    params.push(list);
    fields.push(`blocked_countries=$${params.length}::text[]`);
  }
  if (!fields.length) return;
  params.push(userId);
  await query(`UPDATE model_profiles SET ${fields.join(', ')} WHERE user_id=$${params.length}`, params);
}

export async function setLive(userId, isLive) {
  await query(`UPDATE model_profiles SET is_live=$1 WHERE user_id=$2`, [isLive, userId]);
}
