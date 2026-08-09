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
  updateMyOrganization,
} = require("../controllers/organization.controller");

const router = express.Router();

// --- Public: no auth at all — see the big comment on getPublicOrganization
// itself for why this is the one deliberately open read in this file. ---
// /public (search/list) registered before /public/:slug (one org's detail)
// purely for readability here — Express has no ambiguity between them
// either way, since they're different path shapes (one segment vs two).
router.get("/public", asyncHandler(searchPublicOrganizations));
router.get("/public/:slug", asyncHandler(getPublicOrganization));

// --- Platform-level routes: SUPER_ADMIN only, deliberately NO requireTenant ---
// A Super Admin's JWT has organizationId: null — if requireTenant ran here,
// every one of these calls would be rejected with 403. Skipping it is
// correct, not an oversight; see the big comment in organization.controller.js.
router.post("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(createOrganization));
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listOrganizations));
router.get("/:id", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(getOrganization));
router.patch(
  "/:id/status",
  authenticate,
  requireRole("SUPER_ADMIN"),
  asyncHandler(updateOrganizationStatus)
);

// --- Tenant-scoped routes: ORG_ADMIN managing their OWN organization ---
// Uses /me instead of /:id on purpose — there is no id to pass, which is
// what makes it structurally impossible to request another org's data here.
router.get("/me/profile", authenticate, requireTenant, asyncHandler(getMyOrganization));
router.patch(
  "/me/profile",
  authenticate,
  requireTenant,
  requireRole("ORG_ADMIN"),
  asyncHandler(updateMyOrganization)
);

module.exports = router;
