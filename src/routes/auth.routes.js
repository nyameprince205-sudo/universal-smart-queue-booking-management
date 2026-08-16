const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const {
  login,
  refresh,
  getMe,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification
} = require("../controllers/auth.controller");
const router = express.Router();
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));
router.post("/forgot-password", asyncHandler(forgotPassword));
router.post("/reset-password", asyncHandler(resetPassword));
router.post("/verify-email", asyncHandler(verifyEmail));
router.post("/resend-verification", asyncHandler(resendVerification));
router.get("/me", authenticate, asyncHandler(getMe));
module.exports = router;