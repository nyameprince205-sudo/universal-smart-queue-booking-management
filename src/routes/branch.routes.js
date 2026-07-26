const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  listBranches,
  getBranch,
  createBranch,
  updateBranch,
} = require("../controllers/branch.controller");

const router = express.Router();

// Every route below runs the same three-middleware chain:
//   1. authenticate   -> who is calling? (valid JWT)
//   2. requireTenant   -> which organization do they belong to?
//   3. requireRole      -> are they allowed to do THIS specific action?
// This order matters: you can't check a role or a tenant before you know
// who the user is.
router.use(authenticate, requireTenant);

router.get("/", asyncHandler(listBranches));
router.get("/:id", asyncHandler(getBranch));
router.post("/", requireRole("ORG_ADMIN"), asyncHandler(createBranch));
router.patch("/:id", requireRole("ORG_ADMIN"), asyncHandler(updateBranch));

module.exports = router;
