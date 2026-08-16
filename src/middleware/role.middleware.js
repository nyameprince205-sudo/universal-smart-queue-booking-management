function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(500).json({
        error: "requireRole used before authenticate"
      });
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({
        error: `This action requires one of these roles: ${allowedRoles.join(", ")}`
      });
    }
    return next();
  };
}
module.exports = requireRole;