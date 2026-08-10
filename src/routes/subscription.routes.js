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
  listPaymentHistory,
} = require("../controllers/subscription.controller");

const router = express.Router();

// Public — anyone can see pricing before signing up.
router.get("/plans", asyncHandler(listPlans));

// Paystack calls this directly — deliberately NO authenticate/requireTenant.
// Authenticity is proven by the signature check inside the controller, not
// a JWT (Paystack's servers don't have one, and shouldn't need one).
router.post("/webhook", asyncHandler(paystackWebhook));

// Tenant-scoped: Org Admin manages their own organization's subscription.
router.get("/me", authenticate, requireTenant, asyncHandler(getMySubscription));
router.post(
  "/initialize",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(initializeSubscription)
);
router.get(
  "/verify/:reference",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(verifySubscriptionPayment)
);
router.get(
  "/payments",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(listPaymentHistory)
);

module.exports = router;
