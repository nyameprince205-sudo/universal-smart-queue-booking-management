const { verifyAccessToken } = require("../utils/jwt");

// STEP 1 of the tenant-isolation story: prove WHO is calling.
// This middleware only answers "is this a valid, non-expired token, and
// who does it belong to?" It does NOT decide what that person is allowed
// to touch — that's tenant.middleware.js and role.middleware.js, which run
// AFTER this one. Keeping these concerns in three separate, small
// middlewares (instead of one giant "checkEverything" function) means each
// one is easy to read, test, and reuse independently.
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  const token = header.split(" ")[1];

  try {
    const payload = verifyAccessToken(token);
    // req.auth is the "who" — every downstream middleware/controller reads
    // from here instead of re-decoding the token itself.
    req.auth = {
      userId: payload.sub,
      role: payload.role,
      organizationId: payload.organizationId,
      branchId: payload.branchId,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authenticate;
