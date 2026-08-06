const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  register,
  login,
  refresh,
  getMe,
  getMyOrganizationHistory,
  lookupByPhone,
  quickRegister,
  forgotPassword,
} = require("../controllers/customer.controller");

const router = express.Router();

// --- Customer self-service: public, then self-authenticated ---
router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
// Task 1: request side is customer-specific (keyed by phone, not email —
// see the comment on forgotPassword itself for why). The RESET side is
// shared at POST /auth/reset-password — the token itself already carries
// which account type it belongs to, so there's no need for a second
// reset-password endpoint here too.
router.post("/forgot-password", asyncHandler(forgotPassword));

// authenticate() works unchanged here — it just verifies the JWT signature
// and expiry, regardless of whether the token was signed for a user or a
// customer. requireRole("CUSTOMER") is what actually enforces "this token
// must belong to a customer, not a staff/admin account."
router.get("/me", authenticate, requireRole("CUSTOMER"), asyncHandler(getMe));
router.get(
  "/me/organizations",
  authenticate,
  requireRole("CUSTOMER"),
  asyncHandler(getMyOrganizationHistory)
);

// --- Staff-side: tenant-scoped, used during check-in ---
router.get(
  "/lookup",
  authenticate,
  requireTenant,
  requireRole("STAFF", "ORG_ADMIN"),
  asyncHandler(lookupByPhone)
);
router.post(
  "/quick-register",
  authenticate,
  requireTenant,
  requireRole("STAFF", "ORG_ADMIN"),
  asyncHandler(quickRegister)
);

module.exports = router;
