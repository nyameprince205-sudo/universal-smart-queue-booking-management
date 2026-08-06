// Deliberately NOT retrofitted into existing registration endpoints
// (customer.controller.js's register(), or anywhere else) — Task 6 is
// explicit about not changing existing accepted behavior, and a stricter
// rule here could reject a password that registration already accepted
// historically. This only guards the NEW reset-password endpoint, per
// Task 2's specific requirement.
//
// Returns an error message string if the password is too weak, or null if
// it passes — a null-means-ok return keeps callers simple:
//   const err = validatePasswordStrength(newPassword);
//   if (err) return res.status(400).json({ error: err });
function validatePasswordStrength(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long";
  }
  if (!/[a-zA-Z]/.test(password)) {
    return "Password must contain at least one letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  return null;
}

module.exports = { validatePasswordStrength };
