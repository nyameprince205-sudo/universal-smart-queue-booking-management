const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  listPlans,
  getMySubscription,
  initializeSubscription,
  verifySubscriptionPayment,
  paystackWebhook,
  listPaymentHistory
} = require("../controllers/subscription.controller");
const router = express.Router();
router.get("/plans", asyncHandler(listPlans));
router.post("/webhook", asyncHandler(paystackWebhook));
router.get("/me", authenticate, requireTenant, asyncHandler(getMySubscription));
router.post("/initialize", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(initializeSubscription));
router.get("/verify/:reference", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(verifySubscriptionPayment));
router.get("/payments", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(listPaymentHistory));
module.exports = router;