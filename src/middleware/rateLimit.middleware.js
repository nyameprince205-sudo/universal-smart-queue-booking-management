const rateLimit = require("express-rate-limit");

// Every one of these protects an endpoint that requires no login at all —
// registration requests, the contact form, guest bookings, login itself —
// exactly the ones a script can hit repeatedly with nothing to stop it.
// Three tiers, not one blanket limit, because "a real business submitting
// a registration request" and "someone guessing passwords" are very
// different risk levels and deserve different thresholds.

// Public submissions (registration requests, contact form) — generous
// enough that a real person retrying after a typo isn't blocked, tight
// enough that a script can't flood your database with fake entries.
const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many requests from this address. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login attempts (staff and customer) — the actual target of real
// brute-force attempts, not just accidental spam, so this stays tighter
// than the submission limiter even though it allows more total attempts
// (failed logins are a normal, expected part of real usage — a business
// application enforcing this too aggressively locks out real users who
// just mistyped their password twice).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Guest bookings — more generous than plain submissions, since a genuine
// customer (or someone booking on behalf of a few people) may reasonably
// make several real bookings in one sitting.
const guestBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Too many booking attempts. Please try again in a few minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { submissionLimiter, loginLimiter, guestBookingLimiter };
