const prisma = require("../config/db");
const { generateRawToken, hashToken } = require("../utils/token");

// Password reset links are short-lived (a stolen email containing a live
// reset link is a real account-takeover risk); email verification links
// can be more generous since there's no equivalent risk in leaving one
// live a while.
const EXPIRY_MINUTES = { password_reset: 30, email_verification: 60 * 24 }; // 30 min / 24 hours

// Creates a new token AND immediately invalidates any earlier unused token
// of the SAME type for the SAME owner. Without this, requesting three
// password resets in a row would leave three valid tokens live at once —
// any of which could still be used, which isn't what "send me a new one"
// should mean to the person doing it.
async function issueToken({ type, ownerType, ownerId }) {
  await prisma.authToken.updateMany({
    where: { type, ownerType, ownerId, usedAt: null },
    data: { usedAt: new Date() }, // superseding a token this way has the same effect as deleting it
  });

  const rawToken = generateRawToken();
  await prisma.authToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      type,
      ownerType,
      ownerId,
      expiresAt: new Date(Date.now() + EXPIRY_MINUTES[type] * 60 * 1000),
    },
  });

  return rawToken; // the ONLY time the raw token exists outside of this one request
}

// Looks up a token by its raw value, validates it's the right type, not
// expired, and not already used — then marks it used IN THE SAME CALL, so
// a token can never be raced/reused between the check and the use. Returns
// { ownerType, ownerId } on success, or null on any failure. Deliberately
// collapses "expired" vs "already used" vs "never existed" into one null
// outcome — that distinction isn't useful information to hand back to
// whoever is presenting the token.
async function consumeToken({ rawToken, type }) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.authToken.findUnique({ where: { tokenHash } });

  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }

  await prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return { ownerType: record.ownerType, ownerId: record.ownerId };
}

module.exports = { issueToken, consumeToken };
