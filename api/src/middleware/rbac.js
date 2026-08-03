// Control de acceso por rol (RBAC)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireStaff = requireRole('admin', 'moderator');
export const requireModel = requireRole('model', 'admin');
// Socios: acceso al portal /socio (el admin también entra, para soporte).
export const requirePartner = requireRole('partner', 'admin');
