const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const { listRecentActivity, getNotificationsCenter } = require("../controllers/activity.controller");

const router = express.Router();

// Mounted at /activity — deliberately NOT under /notifications, which
// already exists (Phase 12's SMS/email send audit view) and means
// something different. "/activity/alerts" avoids any ambiguity with that
// existing resource.
router.get("/recent", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(listRecentActivity));
router.get("/alerts", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(getNotificationsCenter));

module.exports = router;
