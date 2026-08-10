const prisma = require("../config/db");

function logActivity({ organizationId, userId, action, entityType, entityId, metadata }) {
  prisma.auditLog
    .create({
      data: {
        organizationId,
        userId: userId || null,
        action,
        entityType,
        entityId: entityId || null,
        metadata: metadata || undefined,
      },
    })
    .catch((err) => {
      console.error("[auditLog] failed to record activity:", err.message);
    });
}

module.exports = { logActivity };
