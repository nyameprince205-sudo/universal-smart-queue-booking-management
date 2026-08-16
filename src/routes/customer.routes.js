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
  listMyCustomers,
  lookupByPhone,
  quickRegister,
  forgotPassword
} = require("../controllers/customer.controller");
const router = express.Router();
router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
router.post("/forgot-password", asyncHandler(forgotPassword));
router.get("/me", authenticate, requireRole("CUSTOMER"), asyncHandler(getMe));
router.get("/me/organizations", authenticate, requireRole("CUSTOMER"), asyncHandler(getMyOrganizationHistory));
router.get("/", authenticate, requireTenant, requireRole("STAFF", "ORG_ADMIN"), asyncHandler(listMyCustomers));
router.get("/lookup", authenticate, requireTenant, requireRole("STAFF", "ORG_ADMIN"), asyncHandler(lookupByPhone));
router.post("/quick-register", authenticate, requireTenant, requireRole("STAFF", "ORG_ADMIN"), asyncHandler(quickRegister));
module.exports = router;