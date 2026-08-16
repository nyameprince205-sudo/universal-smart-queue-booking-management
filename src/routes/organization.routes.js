const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  getPublicOrganization,
  searchPublicOrganizations,
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganizationStatus,
  getMyOrganization,
  updateMyOrganization
} = require("../controllers/organization.controller");
const router = express.Router();
router.get("/public", asyncHandler(searchPublicOrganizations));
router.get("/public/:slug", asyncHandler(getPublicOrganization));
router.post("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(createOrganization));
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listOrganizations));
router.get("/:id", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(getOrganization));
router.patch("/:id/status", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(updateOrganizationStatus));
router.get("/me/profile", authenticate, requireTenant, asyncHandler(getMyOrganization));
router.patch("/me/profile", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(updateMyOrganization));
module.exports = router;