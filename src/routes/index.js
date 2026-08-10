const express = require("express");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const { trackTicket } = require("../controllers/queue.controller");

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: "ok", database: "connected" });
  } catch (err) {
    return res.status(503).json({ status: "error", database: "unreachable" });
  }
});

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
router.use("/analytics", require("./analytics.routes")); // <- Phase 16 Module 4/5/6, mounted now
router.use("/activity", require("./activity.routes")); // <- Phase 18 Module 4/5, mounted now

module.exports = router;
