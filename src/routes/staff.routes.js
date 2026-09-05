const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  requireActiveSubscription
} = require("../middleware/subscription.middleware");
const {
  createStaff,
  listStaff,
  deactivateStaff,
  reactivateStaff
} = require("../controllers/staff.controller");
const router = express.Router();
const {
  getStaffServices,
  setStaffServices,
  getMyServices
} = require("../controllers/staffService.controller");
router.get("/my-services", authenticate, requireTenant, asyncHandler(getMyServices));
router.get("/:id/services", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getStaffServices));
router.put("/:id/services", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(setStaffServices));
router.get("/", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(listStaff));
router.post("/", authenticate, requireTenant, requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(createStaff));
router.patch("/:id/deactivate", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(deactivateStaff));
router.patch("/:id/reactivate", authenticate, requireTenant, requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(reactivateStaff));
module.exports = router;