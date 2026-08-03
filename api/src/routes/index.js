import { Router } from 'express';
import authRoutes from './auth.routes.js';
import contentRoutes from './content.routes.js';
import adminRoutes from './admin.routes.js';
import modelsRoutes from './models.routes.js';
import usersRoutes from './users.routes.js';
import studioRoutes from './studio.routes.js';
import conversationsRoutes from './conversations.routes.js';
import paymentsRoutes from './payments.routes.js';
import liveRoutes from './live.routes.js';
import partnerRoutes from './partner.routes.js';
import { config } from '../config/index.js';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/content', contentRoutes);
router.use('/admin', adminRoutes);
router.use('/models', modelsRoutes);
router.use('/studio', studioRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/live', liveRoutes);
router.use('/partner', partnerRoutes);

// Credenciales TURN efímeras para WebRTC (use-auth-secret de coturn)
router.get('/rtc/credentials', authenticate, (req, res) => {
  const ttl = 3600;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${req.user.id}`;
  const credential = crypto.createHmac('sha1', config.turn.secret).update(username).digest('base64');
  res.json({ urls: config.turn.urls, username, credential, ttl });
});

// Placeholders de dominios restantes (implementar por fase)
router.use('/calls', (req, res) => res.status(501).json({ error: 'not_implemented', domain: 'calls' }));

export default router;
