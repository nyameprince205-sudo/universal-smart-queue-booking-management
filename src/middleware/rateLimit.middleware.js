const rateLimit = require("express-rate-limit");
const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    error: "Too many requests from this address. Please try again in a few minutes."
  },
  standardHeaders: true,
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many login attempts. Please try again in a few minutes."
  },
  standardHeaders: true,
  legacyHeaders: false
});
const guestBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    error: "Too many booking attempts. Please try again in a few minutes."
  },
  standardHeaders: true,
  legacyHeaders: false
});
module.exports = {
  submissionLimiter,
  loginLimiter,
  guestBookingLimiter
};