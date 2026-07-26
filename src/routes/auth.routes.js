const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { login, refresh } = require("../controllers/auth.controller");

const router = express.Router();

// Public routes — no authenticate middleware, obviously (you can't require
// a token to get a token).
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refresh));

module.exports = router;
