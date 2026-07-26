// STEP 3: now that we know WHO (auth.middleware) and WHICH organization
// (tenant.middleware), this answers "are they ALLOWED to do this action?"
//
// Usage on a route:
//   router.post("/services", authenticate, requireTenant, requireRole("ORG_ADMIN"), createService);
//
// requireRole takes one or more allowed role names. Keeping it a plain list
// (rather than a full permissions-table lookup) is deliberate for the MVP —
// your database already has a `permissions` table ready for when a role's
// fixed capability list stops being fine-grained enough. Don't build that
// lookup until you actually need per-user permission overrides.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(500).json({ error: "requireRole used before authenticate" });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        error: `This action requires one of these roles: ${allowedRoles.join(", ")}`,
      });
    }

    return next();
  };
}

module.exports = requireRole;
