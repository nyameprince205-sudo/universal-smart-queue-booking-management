// STEP 2 of the tenant-isolation story, and the single most important file
// in this whole project.
//
// The database has no idea what "the current request" is — every table just
// has an organization_id column sitting there. The ONLY thing standing
// between "Restaurant A" and "Restaurant B's data" is this middleware
// making sure every query downstream is filtered by the right organization_id.
//
// The rule this file enforces: req.tenant.organizationId comes ONLY from the
// verified JWT (req.auth, set by auth.middleware.js) — NEVER from the request
// body, query string, or URL params. If a client could pass organizationId
// in the request body and have it trusted, any logged-in user could read or
// write another organization's data just by changing a field in Postman.
function requireTenant(req, res, next) {
  if (!req.auth) {
    // Defensive check — this middleware must run AFTER authenticate().
    // If this fires, it's a bug in route setup, not a client error.
    return res.status(500).json({ error: "requireTenant used before authenticate" });
  }

  if (!req.auth.organizationId) {
    // SUPER_ADMIN accounts have no organizationId — they use separate,
    // platform-level routes (see routes/platform.routes.js) that don't
    // go through this middleware at all. Hitting this branch means a
    // Super Admin (or a malformed token) tried to hit a tenant-scoped route.
    return res.status(403).json({
      error: "This action requires an organization-scoped account",
    });
  }

  req.tenant = {
    organizationId: BigInt(req.auth.organizationId),
    branchId: req.auth.branchId ? BigInt(req.auth.branchId) : null,
  };

  return next();
}

module.exports = requireTenant;
