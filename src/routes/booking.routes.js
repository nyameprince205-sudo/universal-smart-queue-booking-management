const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const authenticate = require("../middleware/auth.middleware");
const requireTenant = require("../middleware/tenant.middleware");
const requireRole = require("../middleware/role.middleware");
const {
  listBookings,
  createBooking,
  createMyBooking,
  createGuestBooking,
  listMyBookings,
  updateBookingStatus,
  cancelMyBooking
} = require("../controllers/booking.controller");
const router = express.Router();
const { guestBookingLimiter } = require("../middleware/rateLimit.middleware");
router.post("/guest", guestBookingLimiter, asyncHandler(createGuestBooking));
router.post("/guest", asyncHandler(createGuestBooking));
router.get("/mine", authenticate, requireRole("CUSTOMER"), asyncHandler(listMyBookings));
router.post("/mine", authenticate, requireRole("CUSTOMER"), asyncHandler(createMyBooking));
router.patch("/mine/:id/cancel", authenticate, requireRole("CUSTOMER"), asyncHandler(cancelMyBooking));
router.get("/", authenticate, requireTenant, asyncHandler(listBookings));
router.post("/", authenticate, requireTenant, requireRole("STAFF", "ORG_ADMIN"), asyncHandler(createBooking));
router.patch("/:id/status", authenticate, requireTenant, requireRole("STAFF", "ORG_ADMIN"), asyncHandler(updateBookingStatus));
module.exports = router;