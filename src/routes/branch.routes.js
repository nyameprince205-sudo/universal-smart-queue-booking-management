const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  requireActiveSubscription
} = require("../middleware/subscription.middleware");
const {
  listBranches,
  getBranch,
  createBranch,
  updateBranch
} = require("../controllers/branch.controller");
const router = express.Router();
router.use(authenticate, requireTenant);
router.get("/", asyncHandler(listBranches));
router.get("/:id", asyncHandler(getBranch));
router.post("/", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(createBranch));
router.patch("/:id", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(updateBranch));
module.exports = router;