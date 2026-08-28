const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  requireActiveSubscription
} = require("../middleware/subscription.middleware");
const {
  listServices,
  createService,
  updateService,
  deactivateService
} = require("../controllers/service.controller");
const router = express.Router();
router.use(authenticate, requireTenant);
router.get("/", asyncHandler(listServices));
router.post("/", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(createService));
router.patch("/:id", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(updateService));
router.delete("/:id", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(deactivateService));
module.exports = router;