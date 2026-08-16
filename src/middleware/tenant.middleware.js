function requireTenant(req, res, next) {
  if (!req.auth) {
    return res.status(500).json({
      error: "requireTenant used before authenticate"
    });
  }
  if (!req.auth.organizationId) {
    return res.status(403).json({
      error: "This action requires an organization-scoped account"
    });
  }
  req.tenant = {
    organizationId: BigInt(req.auth.organizationId),
    branchId: req.auth.branchId ? BigInt(req.auth.branchId) : null
  };
  return next();
}
module.exports = requireTenant;