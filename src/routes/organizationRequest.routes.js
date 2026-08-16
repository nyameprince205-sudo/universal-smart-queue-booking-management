const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  submitOrganizationRequest,
  listOrganizationRequests,
  reviewOrganizationRequest
} = require("../controllers/organizationRequest.controller");
const router = express.Router();
const { submissionLimiter } = require("../middleware/rateLimit.middleware");
router.post("/", submissionLimiter, asyncHandler(submitOrganizationRequest));
router.post("/", asyncHandler(submitOrganizationRequest));
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listOrganizationRequests));
router.patch("/:id/review", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(reviewOrganizationRequest));
module.exports = router;