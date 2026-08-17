const express = require("express");
const prisma = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const {
  trackTicket
} = require("../controllers/queue.controller");
const router = express.Router();
router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({
      status: "ok",
      database: "connected"
    });
  } catch (err) {
    return res.status(503).json({
      status: "error",
      database: "unreachable"
    });
  }
});
router.get("/queue/track/:uuid", asyncHandler(trackTicket));
router.use("/auth", require("./auth.routes"));
router.use("/organizations", require("./organization.routes"));
router.use("/branches", require("./branch.routes"));
router.use("/services", require("./service.routes"));
router.use("/customers", require("./customer.routes"));
router.use("/bookings", require("./booking.routes"));
router.use("/queue", require("./queue.routes"));
router.use("/notifications", require("./notification.routes"));
router.use("/subscriptions", require("./subscription.routes"));
router.use("/reports", require("./report.routes"));
router.use("/business-types", require("./businessType.routes"));
router.use("/staff", require("./staff.routes"));
router.use("/analytics", require("./analytics.routes"));
router.use("/activity", require("./activity.routes"));
router.use("/organization-requests", require("./organizationRequest.routes"));
router.use("/contact", require("./contact.routes"));
router.use("/platform-users", require("./platformUser.routes"));
router.use("/support", require("./support.routes"));
module.exports = router;