const express = require("express");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { trackTicket } = require("../controllers/queue.controller");

const router = express.Router();

// A REAL health check, not just "the process is running" — it also proves
// Prisma can actually reach MySQL. This is the single most useful endpoint
// during setup: if this fails, you know immediately whether the problem is
// "Express isn't running" or "Express is running but can't reach the DB,"
// which are two completely different things to debug.
router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: "ok", database: "connected" });
  } catch (err) {
    return res.status(503).json({ status: "error", database: "unreachable" });
  }
});

// Phase 16, Module 1: registered here — deliberately BEFORE the "/queue"
// mount below — because queue.routes.js applies `authenticate,
// requireTenant` to its ENTIRE router (see the router.use() at its top).
// This is the one queue-related endpoint that must stay public (a guest
// customer tracking their own ticket has no login at all), so it can't
// live inside that file without either breaking its blanket auth or
// requiring a bigger restructure of a file that already works. Express
// matches routes in registration order, so putting this specific route
// here means it's handled before the /queue mount is ever reached for a
// request to this exact path.
router.get("/queue/track/:uuid", asyncHandler(trackTicket));

// Feature routes, mounted phase by phase:
router.use("/auth", require("./auth.routes")); // <- Phase 6, mounted now
router.use("/organizations", require("./organization.routes")); // <- Phase 7, mounted now
router.use("/branches", require("./branch.routes")); // <- Phase 7, mounted now
router.use("/services", require("./service.routes")); // <- Phase 8, mounted now
router.use("/customers", require("./customer.routes")); // <- Phase 9, mounted now
router.use("/bookings", require("./booking.routes")); // <- Phase 10, mounted now
router.use("/queue", require("./queue.routes")); // <- Phase 11, mounted now
router.use("/notifications", require("./notification.routes")); // <- Phase 12, mounted now
router.use("/subscriptions", require("./subscription.routes")); // <- Phase 13, mounted now
router.use("/reports", require("./report.routes")); // <- Phase 14, mounted now
router.use("/business-types", require("./businessType.routes")); // <- Phase 15 Step 6, mounted now
router.use("/staff", require("./staff.routes"));

module.exports = router;
