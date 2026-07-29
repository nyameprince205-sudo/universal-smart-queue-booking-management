const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const { listNotifications } = require("../controllers/notification.controller");

const router = express.Router();

router.get(
  "/",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(listNotifications)
);

module.exports = router;
