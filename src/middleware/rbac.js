'use strict';

function requirePermission(...keys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (req.user.isSuperAdmin) return next();
    const ok = keys.every((k) => req.permissions && req.permissions.has(k));
    if (!ok) {
      if (req.accepts('html')) {
        return res.status(403).render('errors/403', { reason: 'missing_permission', perms: keys });
      }
      return res.status(403).json({ error: 'forbidden', missing: keys });
    }
    next();
  };
}

module.exports = { requirePermission };
