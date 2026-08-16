const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  listServices,
  createService,
  deactivateService
} = require("../controllers/service.controller");
const router = express.Router();
router.use(authenticate, requireTenant);
router.get("/", asyncHandler(listServices));
router.post("/", requireRole("ORG_ADMIN"), asyncHandler(createService));
router.delete("/:id", requireRole("ORG_ADMIN"), asyncHandler(deactivateService));
module.exports = router;