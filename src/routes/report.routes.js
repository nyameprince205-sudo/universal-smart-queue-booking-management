const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  getBookingReport,
  getQueuePerformanceReport,
  getNoShowReport,
  getDashboardSummary
} = require("../controllers/report.controller");
const router = express.Router();
router.get("/bookings", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getBookingReport));
router.get("/queue-performance", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getQueuePerformanceReport));
router.get("/no-shows", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getNoShowReport));
router.get("/dashboard", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getDashboardSummary));
module.exports = router;