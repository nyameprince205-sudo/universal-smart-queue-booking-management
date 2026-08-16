const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  submitContactForm,
  listContactSubmissions,
  markContactSubmissionRead
} = require("../controllers/contact.controller");
const router = express.Router();
router.post("/", asyncHandler(submitContactForm));
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listContactSubmissions));
router.patch("/:id/read", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(markContactSubmissionRead));
module.exports = router;