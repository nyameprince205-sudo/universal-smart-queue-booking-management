const crypto = require("crypto");

// The raw token is what goes in the email link — 32 random bytes, hex
// encoded, so it's URL-safe with no special characters to escape. The
// HASH of that token is what's ever stored in the database (see
// AuthToken.tokenHash in schema.prisma) — this file is the one place that
// relationship is defined, so it can never accidentally drift (e.g. one
// code path hashing with sha256 and another comparing against md5).
function generateRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

module.exports = { generateRawToken, hashToken };
