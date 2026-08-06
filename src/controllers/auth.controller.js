const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");
const { issueToken, consumeToken } = require("../services/authToken.service");
const { sendEmail } = require("../services/notification.service");
const { validatePasswordStrength } = require("../utils/passwordStrength");

// Staff/Admin login. Customers are a deliberately SEPARATE auth flow later
// (see Section 6 of DATABASE_DESIGN.md — customers aren't `users` rows),
// so this controller only ever looks in the `users` table.
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  // Deliberately vague error message (not "email not found" vs "wrong
  // password" separately) — specific messages let an attacker enumerate
  // which emails exist in the system.
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Gated behind an env var (default OFF) rather than always-on — nothing
  // in this app has ever created a verified-from-scratch account (see the
  // big comment on User.emailVerified in schema.prisma: no staff/admin
  // creation endpoint exists yet), so enforcing this unconditionally would
  // have no legitimate way for a real new account to ever pass it. Once a
  // real "invite staff" flow exists and actually sends verification
  // emails, flip REQUIRE_EMAIL_VERIFICATION=true in .env to turn this on.
  if (process.env.REQUIRE_EMAIL_VERIFICATION === "true" && !user.emailVerified) {
    return res.status(403).json({ error: "Please verify your email address before logging in." });
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      role: user.role.name,
      organizationId: user.organizationId ? user.organizationId.toString() : null,
      branchId: user.branchId ? user.branchId.toString() : null,
    },
  });
}

// Exchanges a still-valid refresh token for a new access token, without
// forcing the user to log in again every 15 minutes (the access token's
// short lifetime). The refresh token itself is longer-lived and should be
// stored more carefully client-side (httpOnly cookie in a real deployment —
// a bare JSON response is fine while you're learning the mechanics).
async function refresh(req, res) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: BigInt(payload.sub) },
    include: { role: true },
  });

  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  // This is what makes Task 2's "force re-login after reset" actually
  // real, without needing a server-side refresh-token blocklist table (a
  // bigger architecture change this project deliberately avoids — see the
  // conversation notes on why). Every JWT carries an `iat` (issued-at)
  // claim automatically. If this refresh token was issued BEFORE the most
  // recent password reset, it represents a session from before that reset
  // — reject it. A refresh token issued AFTER a reset (i.e. from actually
  // logging back in with the new password) has iat > passwordChangedAt and
  // sails through normally.
  if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
    return res.status(401).json({ error: "Your password was changed. Please log in again." });
  }

  const accessToken = signAccessToken(user);
  return res.json({ accessToken });
}

// Returns the currently logged-in user's own profile. Every field here comes
// from req.auth, which auth.middleware.js already populated from the
// verified JWT — this controller doesn't re-check the token itself, it
// trusts the middleware that ran before it. That's the whole point of
// putting authenticate() in front of this route instead of duplicating
// token-checking logic in every controller that needs "who is this."
async function getMe(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: BigInt(req.auth.userId) },
    include: { role: true },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    role: user.role.name,
    organizationId: user.organizationId ? user.organizationId.toString() : null,
    branchId: user.branchId ? user.branchId.toString() : null,
    lastLoginAt: user.lastLoginAt,
  });
}

// ---- Task 1: Forgot Password ----
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({ where: { email } });

  // The response is IDENTICAL whether or not an account exists — this is
  // Task 1's explicit "do not expose whether an email exists" requirement.
  // The token is only ever generated/sent inside this if-block; the HTTP
  // response outside it never varies based on that.
  if (user && user.status === "active") {
    const rawToken = await issueToken({ type: "password_reset", ownerType: "user", ownerId: user.id });
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
    await sendEmail(user.email, `Reset your password: ${resetLink} (this link expires in 30 minutes)`);
  }

  return res.json({ message: "If an account exists with that email, a password reset link has been sent." });
}

// ---- Task 2: Reset Password ----
// SHARED between staff/admin (User) and Customer accounts — see
// customer.controller.js's forgotPassword for the customer-side request
// step. The token itself (via authToken.service's ownerType) tells this
// function which table to update, so one endpoint serves both account
// types instead of duplicating this logic twice. This is the "shared
// token system" behind both login pages' reset flows.
async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and newPassword are required" });
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) return res.status(400).json({ error: strengthError });

  const result = await consumeToken({ rawToken: token, type: "password_reset" });
  if (!result) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();

  if (result.ownerType === "user") {
    await prisma.user.update({ where: { id: result.ownerId }, data: { passwordHash, passwordChangedAt: now } });
  } else {
    await prisma.customer.update({ where: { id: result.ownerId }, data: { passwordHash, passwordChangedAt: now } });
  }

  // Deliberately NOT returning accessToken/refreshToken here (unlike
  // login) — see refresh()'s passwordChangedAt check above for how this
  // combines with NOT issuing a session to actually force a real re-login,
  // not just a cosmetic redirect to the login page.
  return res.json({ message: "Password reset successfully. Please log in with your new password." });
}

// ---- Task 3: Email Verification (infrastructure only — see the plan
// comment: nothing creates a User via the API yet, so nothing actually
// calls issueToken({type: "email_verification"...}) in this codebase
// today. This endpoint is ready for whenever that changes.) ----
async function verifyEmail(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token is required" });

  const result = await consumeToken({ rawToken: token, type: "email_verification" });
  if (!result) {
    return res.status(400).json({ error: "This verification link is invalid or has expired." });
  }

  // Only ownerType "user" is meaningful here — Customer deliberately has
  // no emailVerified column at all (Task 3 explicitly scopes verification
  // to Super Admin/Org Admin/Staff, not customers), so there's nothing to
  // set for a customer-owned token even if one existed.
  if (result.ownerType === "user") {
    await prisma.user.update({ where: { id: result.ownerId }, data: { emailVerified: true } });
  }

  return res.json({ message: "Email verified successfully." });
}

async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email is required" });

  const user = await prisma.user.findUnique({ where: { email } });

  // Same non-enumeration principle as forgotPassword — identical response
  // regardless of whether the account exists or is already verified.
  if (user && user.status === "active" && !user.emailVerified) {
    const rawToken = await issueToken({ type: "email_verification", ownerType: "user", ownerId: user.id });
    const verifyLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
    await sendEmail(user.email, `Verify your email: ${verifyLink} (this link expires in 24 hours)`);
  }

  return res.json({ message: "If an account exists and needs verification, a new verification email has been sent." });
}

module.exports = { login, refresh, getMe, forgotPassword, resetPassword, verifyEmail, resendVerification };
