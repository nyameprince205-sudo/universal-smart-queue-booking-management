const prisma = require("../config/db");
async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });
  return res.json(notifications.map(n => ({
    id: n.id.toString(),
    recipientType: n.recipientType,
    recipientId: n.recipientId.toString(),
    channel: n.channel,
    message: n.message,
    status: n.status,
    sentAt: n.sentAt,
    createdAt: n.createdAt
  })));
}
module.exports = {
  listNotifications
};