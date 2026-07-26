const jwt = require("jsonwebtoken");

// What goes INSIDE the token matters as much as the token mechanism itself.
// We deliberately keep the payload small and put exactly what tenant-scoping
// and role-checking need — nothing more (never put passwordHash, full user
// objects, etc. in a JWT; it's readable by anyone who has the token).
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id.toString(), // JWT "subject" convention = the user id
      role: user.role.name, // e.g. "ORG_ADMIN" — used by role.middleware.js
      organizationId: user.organizationId ? user.organizationId.toString() : null,
      branchId: user.branchId ? user.branchId.toString() : null,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user.id.toString() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

// Customers get their OWN signing functions rather than being shoehorned
// into signAccessToken (which expects a `.role.name` and org/branch fields
// that come from the `users` table shape). Keeping this explicit makes it
// obvious at a glance that a customer token is structurally different: role
// is hardcoded to "CUSTOMER" and there is no organizationId/branchId at all
// — a customer isn't scoped to one organization, ever.
function signCustomerAccessToken(customer) {
  return jwt.sign(
    {
      sub: customer.id.toString(),
      role: "CUSTOMER",
      organizationId: null,
      branchId: null,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );
}

function signCustomerRefreshToken(customer) {
  return jwt.sign(
    { sub: customer.id.toString() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signCustomerAccessToken,
  signCustomerRefreshToken,
};
