import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { requireModel } from '../middleware/rbac.js';
import * as models from '../services/models.service.js';
import { viewerCountry, isCountryBlocked } from '../services/geo.service.js';

const router = Router();

// ---------- Descubrimiento (público) ----------
const listQuery = z.object({
  q: z.string().max(80).optional(),
  filter: z.enum(['all', 'live', 'online', 'new', 'near']).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
  offset: z.coerce.number().min(0).optional(),
});

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const p = listQuery.parse(req.query);
    const country = await viewerCountry(req);
    const items = await models.listModels({
      q: p.q || '', filter: p.filter || 'all',
      lat: p.lat, lng: p.lng, limit: p.limit || 24, offset: p.offset || 0,
      viewerCountry: country,
    });
    res.json({ items, count: items.length });
  } catch (e) { next(e); }
});

// ---------- Perfil público por handle ----------
router.get('/:handle', optionalAuth, async (req, res, next) => {
  try {
    const model = await models.getModelByHandle(req.params.handle);
    if (!model) return res.status(404).json({ error: 'not_found' });
    // Geo-bloqueo: para el país bloqueado la creadora es invisible (404).
    const own = req.user?.id === model.id;
    if (!own) {
      const country = await viewerCountry(req);
      if (isCountryBlocked(country, model.blockedCountries)) return res.status(404).json({ error: 'not_found' });
    }
    const { blockedCountries, ...pub } = model;   // no exponer la lista al público
    res.json(pub);
  } catch (e) { next(e); }
});

// ---------- Convertirse en modelo ----------
const becomeSchema = z.object({
  handle: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/, 'handle_invalido'),
  headline: z.string().max(140).optional(),
  monthlyPriceCop: z.number().int().min(0).optional(),
});
router.post('/me', authenticate, async (req, res, next) => {
  try {
    const data = becomeSchema.parse(req.body);
    const result = await models.becomeModel(req.user.id, data);
    // El rol cambió a 'model' en BD, pero el JWT actual aún dice 'user' →
    // re-emitir el access token para que las rutas requireModel lo acepten ya.
    const { signAccess } = await import('../middleware/auth.js');
    const accessToken = signAccess({ id: req.user.id, role: 'model' });
    res.status(201).json({ ...result, accessToken });
  } catch (e) { next(e); }
});

// ---------- Ajustes propios de la creadora (consola) ----------
router.get('/me/settings', authenticate, requireModel, async (req, res, next) => {
  try {
    const s = await models.getModelSettings(req.user.id);
    if (!s) return res.status(404).json({ error: 'not_a_model' });
    res.json(s);
  } catch (e) { next(e); }
});

// ---------- Actualizar perfil de modelo ----------
const updateSchema = z.object({
  headline: z.string().max(140).optional(),
  monthlyPriceCop: z.number().int().min(0).optional(),
  acceptsCalls: z.boolean().optional(),
  callPriceDiamonds: z.number().int().min(0).max(100000).optional(),
  blockedCountries: z.array(z.string().length(2)).max(250).optional(),
});
router.patch('/me', authenticate, requireModel, async (req, res, next) => {
  try {
    await models.updateModelProfile(req.user.id, updateSchema.parse(req.body));
    res.json({ ok: true });
  } catch (e) { if (e?.name === 'ZodError') return res.status(400).json({ error: 'invalid' }); next(e); }
});

// ---------- Activar/desactivar "en vivo" ----------
router.post('/me/live', authenticate, requireModel, async (req, res, next) => {
  try {
    await models.setLive(req.user.id, req.body?.isLive === true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Enviar solicitud KYC ----------
import { query as dbQuery } from '../config/db.js';

// Formato de documento por tipo (validación de la verificación automática):
//   cc  = cédula de ciudadanía (CO): 6-10 dígitos
//   ce  = cédula de extranjería:     6-12 dígitos
//   passport = alfanumérico 5-15
const DOC_FORMATS = { cc: /^\d{6,10}$/, ce: /^\d{6,12}$/, passport: /^[A-Za-z0-9]{5,15}$/ };
const kycSchema = z.object({
  fullName:       z.string().min(3).max(160).regex(/^[\p{L}\s.'-]+$/u, 'nombre_invalido'),
  documentType:   z.enum(['cc','ce','passport']),
  documentNumber: z.string().min(5).max(20),
}).superRefine((d, ctx) => {
  const num = d.documentNumber.replace(/[\s.-]/g, '');   // tolera espacios/puntos/guiones
  if (!DOC_FORMATS[d.documentType].test(num))
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'documento_formato_invalido' });
  // Rechaza secuencias obviamente falsas (todos iguales).
  if (/^(\w)\1+$/.test(num))
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'documento_invalido' });
});

router.post('/me/kyc', authenticate, async (req, res, next) => {
  try {
    const d = kycSchema.parse(req.body);
    const existing = (await dbQuery(
      `SELECT id, status FROM kyc_verifications WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 1`,
      [req.user.id]
    )).rows[0];
    if (existing && ['submitted','in_review','approved'].includes(existing.status))
      return res.status(409).json({ error: 'kyc_already_submitted', status: existing.status });

    // El hash del número de documento evita guardarlo en claro. Se normaliza
    // (sin espacios/puntos/guiones) para que la barrera antiduplicado sea robusta.
    const { createHash } = await import('node:crypto');
    const docNorm = d.documentNumber.replace(/[\s.-]/g, '');
    const docHash = createHash('sha256').update(docNorm).digest('hex');

    const { rows } = await dbQuery(
      `INSERT INTO kyc_verifications (user_id,status,full_name,document_type,document_number_hash)
       VALUES ($1,'submitted',$2,$3,$4) RETURNING id`,
      [req.user.id, d.fullName, d.documentType, docHash]
    );
    const kycId = rows[0].id;
    await dbQuery(`UPDATE model_profiles SET kyc_status='submitted' WHERE user_id=$1`, [req.user.id]);

    // Evaluación AUTOMÁTICA (escala). Barreras: edad 18+ y antiduplicado siempre.
    const { evaluateKyc, applyDecision } = await import('../services/kyc.service.js');
    const verdict = await evaluateKyc({ userId: req.user.id, docHash });
    if (verdict.decision === 'approved' || verdict.decision === 'rejected') {
      await applyDecision({ kycId, userId: req.user.id, decision: verdict.decision, source: 'auto', notes: verdict.reason, ip: req.ip });
      return res.status(201).json({ id: kycId, status: verdict.decision, auto: true, reason: verdict.reason });
    }
    res.status(201).json({ id: kycId, status: 'in_review', auto: false, reason: verdict.reason });
  } catch (e) { next(e); }
});

export default router;
