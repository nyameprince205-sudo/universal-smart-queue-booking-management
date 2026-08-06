const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const { login, refresh, getMe, forgotPassword, resetPassword, verifyEmail, resendVerification } = require("../controllers/auth.controller");

const router = express.Router();

// Public routes — no authenticate middleware, obviously (you can't require
// a token to get a token).
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));

// Task 1/2/3: also public — a user who's locked out or hasn't verified yet
// has no token to authenticate WITH, so these can't sit behind authenticate().
router.post("/forgot-password", asyncHandler(forgotPassword));
router.post("/reset-password", asyncHandler(resetPassword));
router.post("/verify-email", asyncHandler(verifyEmail));
router.post("/resend-verification", asyncHandler(resendVerification));

// Protected route — this is the first route in the whole project that
// actually requires a valid JWT. If you hit this without a token (or with
// a garbage one), auth.middleware.js rejects it with 401 before getMe ever
// runs.
router.get("/me", authenticate, asyncHandler(getMe));

module.exports = router;
