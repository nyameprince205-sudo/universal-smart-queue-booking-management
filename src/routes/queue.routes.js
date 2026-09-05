const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  getMyCounter,
  assignCounter
} = require("../controllers/myCounter.controller");
const {
  requireActiveSubscription
} = require("../middleware/subscription.middleware");
const {
  checkIn,
  callNext,
  markServing,
  completeTicket,
  markMissed,
  liveBoard,
  createCounter,
  listCounters
} = require("../controllers/queue.controller");
const router = express.Router();
router.use(authenticate, requireTenant);
router.get("/my-counter", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(getMyCounter));
router.patch("/counters/:id/assign", requireRole("ORG_ADMIN"), asyncHandler(assignCounter));
router.get("/board", asyncHandler(liveBoard));
router.get("/counters", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(listCounters));
router.post("/counters", requireRole("ORG_ADMIN"), requireActiveSubscription, asyncHandler(createCounter));
router.post("/check-in", requireRole("STAFF", "ORG_ADMIN"), requireActiveSubscription, asyncHandler(checkIn));
router.post("/call-next", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(callNext));
router.patch("/:id/serving", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(markServing));
router.patch("/:id/complete", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(completeTicket));
router.patch("/:id/missed", requireRole("STAFF", "ORG_ADMIN"), asyncHandler(markMissed));
router.get("/queue/my-counter", authenticate, requireTenant, asyncHandler(getMyCounter));
router.patch("/queue/counters/:id/assign", authenticate, requireTenant, requireRole("ORG_ADMIN"), asyncHandler(assignCounter));
module.exports = router;