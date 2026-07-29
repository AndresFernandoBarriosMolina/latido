import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import {
  listConversations, listMessages, saveMessage, getOrCreateConversation,
} from '../services/messages.service.js';
import { modelBlocksUser } from '../services/geo.service.js';

// ============================================================================
//  Conversaciones del usuario (mensajería cifrada en reposo).
//  Solo los participantes pueden leer/escribir; el cuerpo se descifra al vuelo.
// ============================================================================
const router = Router();
router.use(authenticate);

// Bandeja: lista de conversaciones con último mensaje.
router.get('/', async (req, res, next) => {
  try {
    res.json({ items: await listConversations(req.user.id) });
  } catch (e) { next(e); }
});

// Historial de una conversación (debe ser participante).
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { limit, before } = z.object({
      limit: z.coerce.number().min(1).max(100).optional(),
      before: z.string().datetime().optional(),
    }).parse(req.query);
    const items = await listMessages(req.params.id, req.user.id, { limit, before });
    res.json({ items });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// Enviar mensaje por REST (alternativa al socket; mismo cifrado en reposo).
router.post('/with/:otherId/messages', async (req, res, next) => {
  try {
    const { message } = z.object({ message: z.string().min(1).max(2000) }).parse(req.body);
    if (await modelBlocksUser(req.params.otherId, req.user.id)) return res.status(403).json({ error: 'not_available' });
    const saved = await saveMessage({ fromId: req.user.id, toId: req.params.otherId, text: message });
    res.status(201).json(saved);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// Abrir/obtener el id de conversación con otro usuario.
router.get('/with/:otherId', async (req, res, next) => {
  try {
    if (await modelBlocksUser(req.params.otherId, req.user.id)) return res.status(403).json({ error: 'not_available' });
    const id = await getOrCreateConversation(req.user.id, req.params.otherId);
    res.json({ conversationId: id });
  } catch (e) { next(e); }
});

export default router;
