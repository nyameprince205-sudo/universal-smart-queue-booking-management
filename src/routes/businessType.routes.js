const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  listBusinessTypes
} = require("../controllers/businessType.controller");
const router = express.Router();
router.get("/", authenticate, requireRole("SUPER_ADMIN"), asyncHandler(listBusinessTypes));
module.exports = router;