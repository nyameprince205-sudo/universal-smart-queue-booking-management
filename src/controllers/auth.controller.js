const bcrypt = require("bcryptjs");
const prisma = require("../config/db");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");

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

  const accessToken = signAccessToken(user);
  return res.json({ accessToken });
}

module.exports = { login, refresh };
