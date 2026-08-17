const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  createTicket,
  listMyTickets,
  listInboxTickets,
  getTicket,
  replyToTicket,
  resolveTicket
} = require("../controllers/support.controller");
const router = express.Router();
router.post("/", authenticate, asyncHandler(createTicket));
router.get("/mine", authenticate, asyncHandler(listMyTickets));
router.get("/inbox", authenticate, asyncHandler(listInboxTickets));
router.get("/:id", authenticate, asyncHandler(getTicket));
router.post("/:id/reply", authenticate, asyncHandler(replyToTicket));
router.patch("/:id/resolve", authenticate, requireRole("ORG_ADMIN", "SUPER_ADMIN"), asyncHandler(resolveTicket));
module.exports = router;