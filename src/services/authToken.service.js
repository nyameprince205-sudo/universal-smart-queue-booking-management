const prisma = require("../config/db");
const {
  generateRawToken,
  hashToken
} = require("../utils/token");
const EXPIRY_MINUTES = {
  password_reset: 30,
  email_verification: 60 * 24
};
async function issueToken({
  type,
  ownerType,
  ownerId
}) {
  await prisma.authToken.updateMany({
    where: {
      type,
      ownerType,
      ownerId,
      usedAt: null
    },
    data: {
      usedAt: new Date()
    }
  });
  const rawToken = generateRawToken();
  await prisma.authToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      type,
      ownerType,
      ownerId,
      expiresAt: new Date(Date.now() + EXPIRY_MINUTES[type] * 60 * 1000)
    }
  });
  return rawToken;
}
async function consumeToken({
  rawToken,
  type
}) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.authToken.findUnique({
    where: {
      tokenHash
    }
  });
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }
  await prisma.authToken.update({
    where: {
      id: record.id
    },
    data: {
      usedAt: new Date()
    }
  });
  return {
    ownerType: record.ownerType,
    ownerId: record.ownerId
  };
}
module.exports = {
  issueToken,
  consumeToken
};