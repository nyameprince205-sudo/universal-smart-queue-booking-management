const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  getServicePopularity,
  getPeakHours,
  getBookingTrends,
  getStaffPerformance,
  getBranchComparison,
  getRevenueReport,
  getExecutiveSummary,
} = require("../controllers/analytics.controller");

const router = express.Router();

// ORG_ADMIN-only, same reasoning as report.routes.js — these are business
// performance numbers for the owner, not a front-line staff concern.
router.get("/service-popularity", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getServicePopularity));
router.get("/peak-hours", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getPeakHours));
router.get("/trends", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getBookingTrends));
router.get("/staff-performance", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getStaffPerformance));
router.get("/branches", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getBranchComparison));
router.get("/revenue", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getRevenueReport));
router.get("/executive-summary", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getExecutiveSummary));

module.exports = router;
