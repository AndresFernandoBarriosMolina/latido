import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

// Verifica el access token (JWT) y adjunta req.user = { id, role }
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Autenticación opcional (visitantes): no falla si no hay token
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { const p = jwt.verify(token, config.jwt.accessSecret); req.user = { id: p.sub, role: p.role }; } catch {}
  }
  next();
}

// NOTA: el control de acceso por rol vive exclusivamente en middleware/rbac.js
// (requireRole / requireAdmin / requireStaff / requireModel). No reintroducir
// una segunda implementación aquí: tener dos divergía la lógica de autorización.

export function signAccess(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.accessSecret, { expiresIn: config.jwt.accessTtl });
}
export function signRefresh(user) {
  return jwt.sign({ sub: user.id }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshTtl });
}
