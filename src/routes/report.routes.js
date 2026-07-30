const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  getBookingReport,
  getQueuePerformanceReport,
  getNoShowReport,
  getDashboardSummary,
} = require("../controllers/report.controller");

const router = express.Router();

// Reports are ORG_ADMIN-only for now — these numbers (booking volume,
// no-show rates, wait times) are business performance data for the owner,
// not something front-line Staff need on a shift-by-shift basis. If a
// later phase wants Staff to see live floor performance, that's a
// deliberate call to add "STAFF" to these lists, not an oversight.
router.get("/bookings", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getBookingReport));
router.get(
  "/queue-performance",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(getQueuePerformanceReport)
);
router.get("/no-shows", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getNoShowReport));
router.get("/dashboard", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getDashboardSummary));

module.exports = router;
