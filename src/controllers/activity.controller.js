const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
const ACTION_MESSAGES = {
  customer_joined_queue: log => `Customer joined the queue${log.metadata?.ticketNumber ? ` (ticket ${log.metadata.ticketNumber})` : ""}`,
  service_completed: log => `${log.user?.name || "Staff"} completed a service${log.metadata?.ticketNumber ? ` (ticket ${log.metadata.ticketNumber})` : ""}`,
  customer_missed: log => `A customer was marked missed${log.metadata?.ticketNumber ? ` (ticket ${log.metadata.ticketNumber})` : ""}`,
  booking_created: () => "New booking received",
  booking_cancelled: () => "A booking was cancelled",
  appointment_completed: log => `${log.user?.name || "Staff"} completed an appointment`,
  staff_created: log => `${log.user?.name || "An admin"} added a new staff account`
};
function formatActivityEntry(log) {
  const formatter = ACTION_MESSAGES[log.action];
  return {
    id: log.id.toString(),
    action: log.action,
    message: formatter ? formatter(log) : log.action,
    userName: log.user?.name || null,
    createdAt: log.createdAt
  };
}
async function listRecentActivity(req, res) {
  const logs = await prisma.auditLog.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 30,
    include: {
      user: {
        select: {
          name: true
        }
      }
    }
  });
  return res.json(toJSONSafe(logs.map(formatActivityEntry)));
}
const QUEUE_CROWDED_THRESHOLD = 5;
const SUBSCRIPTION_EXPIRING_DAYS = 7;
async function getNotificationsCenter(req, res) {
  const organizationId = req.tenant.organizationId;
  const notifications = [];
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId,
      status: {
        in: ["trial", "active"]
      }
    },
    orderBy: {
      endDate: "desc"
    }
  });
  if (subscription) {
    const daysLeft = Math.ceil((subscription.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft >= 0 && daysLeft <= SUBSCRIPTION_EXPIRING_DAYS) {
      notifications.push({
        type: "subscription_expiring",
        severity: "warning",
        message: `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
      });
    }
  }
  const [branches, waitingTickets] = await Promise.all([prisma.branch.findMany({
    where: {
      organizationId
    },
    select: {
      id: true,
      name: true
    }
  }), prisma.queueTicket.findMany({
    where: {
      organizationId,
      status: "waiting"
    },
    select: {
      branchId: true
    }
  })]);
  for (const branch of branches) {
    const waiting = waitingTickets.filter(t => t.branchId === branch.id).length;
    if (waiting > QUEUE_CROWDED_THRESHOLD) {
      notifications.push({
        type: "queue_crowded",
        severity: "warning",
        message: `${branch.name} has ${waiting} customers waiting`
      });
    }
  }
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const recentBookings = await prisma.booking.count({
    where: {
      organizationId,
      createdAt: {
        gte: twoHoursAgo
      }
    }
  });
  if (recentBookings > 0) {
    notifications.push({
      type: "new_bookings",
      severity: "info",
      message: `${recentBookings} new booking${recentBookings === 1 ? "" : "s"} in the last 2 hours`
    });
  }
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentPayments = await prisma.payment.findMany({
    where: {
      organizationId,
      createdAt: {
        gte: oneDayAgo
      }
    },
    select: {
      status: true
    }
  });
  const successfulCount = recentPayments.filter(p => p.status === "successful").length;
  const failedCount = recentPayments.filter(p => p.status === "failed").length;
  if (successfulCount > 0) {
    notifications.push({
      type: "payment_success",
      severity: "success",
      message: `${successfulCount} successful payment${successfulCount === 1 ? "" : "s"} in the last 24 hours`
    });
  }
  if (failedCount > 0) {
    notifications.push({
      type: "payment_failed",
      severity: "error",
      message: `${failedCount} failed payment${failedCount === 1 ? "" : "s"} in the last 24 hours`
    });
  }
  return res.json(toJSONSafe({
    notifications,
    count: notifications.length
  }));
}
module.exports = {
  listRecentActivity,
  getNotificationsCenter
};