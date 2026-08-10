const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const { createStaff, listStaff, deactivateStaff, reactivateStaff } = require("../controllers/staff.controller");

const router = express.Router();

router.get("/", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(listStaff));
router.post("/", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(createStaff));
router.patch("/:id/deactivate", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(deactivateStaff));
router.patch("/:id/reactivate", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(reactivateStaff));

module.exports = router;
