const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  checkIn,
  callNext,
  markServing,
  completeTicket,
  liveBoard,
  createCounter,
} = require("../controllers/queue.controller");

const router = express.Router();

router.use(authenticate, requireTenant);

router.get("/board", asyncHandler(liveBoard));
router.post("/counters", requireRole("ORG_ADMIN"), asyncHandler(createCounter));
router.post("/check-in", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(checkIn));
router.post("/call-next", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(callNext));
router.patch("/:id/serving", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(markServing));
router.patch("/:id/complete", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(completeTicket));

module.exports = router;
