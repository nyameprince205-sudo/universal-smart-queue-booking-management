const {
  verifyAccessToken
} = require("../utils/jwt");
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing or malformed Authorization header"
    });
  }
  const token = header.split(" ")[1];
  try {
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      role: payload.role,
      organizationId: payload.organizationId,
      branchId: payload.branchId
    };
    return next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
}
module.exports = authenticate;