const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const { submitContactForm, listContactSubmissions, markContactSubmissionRead } = require("../controllers/contact.controller");

const router = express.Router();

// Public — anyone reaching out has no login by definition.
router.post("/", asyncHandler(submitContactForm));

// SUPER_ADMIN only, same platform-level reasoning as organization requests.
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listContactSubmissions));
router.patch("/:id/read", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(markContactSubmissionRead));

module.exports = router;
