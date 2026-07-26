const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const { login, refresh, getMe } = require("../controllers/auth.controller");

const router = express.Router();

// Public routes — no authenticate middleware, obviously (you can't require
// a token to get a token).
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));

// Protected route — this is the first route in the whole project that
// actually requires a valid JWT. If you hit this without a token (or with
// a garbage one), auth.middleware.js rejects it with 401 before getMe ever
// runs.
router.get("/me", authenticate, asyncHandler(getMe));

module.exports = router;
