const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const { listOrgAdmins, deactivateOrgAdmin, reactivateOrgAdmin } = require("../controllers/platformUser.controller");

const router = express.Router();

// SUPER_ADMIN only, deliberately no requireTenant — a Super Admin's JWT
// has organizationId: null, and this operates across every organization
// by design, same reasoning as organization-requests and platform org
// management routes.
router.get("/org-admins", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listOrgAdmins));
router.patch("/org-admins/:id/deactivate", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(deactivateOrgAdmin));
router.patch("/org-admins/:id/reactivate", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(reactivateOrgAdmin));

module.exports = router;
