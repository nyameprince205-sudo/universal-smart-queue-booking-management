const prisma = require("../config/db");

// This is a READ-ONLY controller — notifications are never created directly
// through a route; they're always a side effect of some other action
// (a booking, a check-in, a call-next) via notification.service.js. This
// endpoint just lets an Org Admin see what's actually been sent, for
// troubleshooting ("did the customer really get an SMS?") and basic audit.
async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({
    where: { organizationId: req.tenant.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50, // most-recent-first, capped — this is a debugging view, not a report
  });

  return res.json(
    notifications.map((n) => ({
      id: n.id.toString(),
      recipientType: n.recipientType,
      recipientId: n.recipientId.toString(),
      channel: n.channel,
      message: n.message,
      status: n.status,
      sentAt: n.sentAt,
      createdAt: n.createdAt,
    }))
  );
}

module.exports = { listNotifications };
