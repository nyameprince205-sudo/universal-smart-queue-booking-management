const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  submitOrganizationRequest,
  listOrganizationRequests,
  reviewOrganizationRequest,
} = require("../controllers/organizationRequest.controller");

const router = express.Router();

// Public — anyone can submit, no login exists yet for a business that
// isn't on the platform.
router.post("/", asyncHandler(submitOrganizationRequest));

// SUPER_ADMIN only, deliberately NO requireTenant — same reasoning as
// organization.routes.js's platform-level routes: a Super Admin's JWT has
// organizationId: null, and these requests don't belong to any org yet
// anyway (that's the whole point of a REQUEST).
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listOrganizationRequests));
router.patch("/:id/review", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(reviewOrganizationRequest));

module.exports = router;
