const prisma = require("../config/db");
const {
  randomUUID
} = require("crypto");
const {
  emitQueueUpdate,
  emitBookingUpdate
} = require("../socket");
const {
  notifyInBackground,
  getPreferredChannel
} = require("../services/notification.service");
const {
  logActivity
} = require("../services/auditLog.service");
const {
  toJSONSafe
} = require("../utils/serialize");
async function createCounter(req, res) {
  const {
    branchId,
    name
  } = req.body;
  if (!branchId || !name) return res.status(400).json({
    error: "branchId and name are required"
  });
  const branch = await prisma.branch.findFirst({
    where: {
      id: BigInt(branchId),
      organizationId: req.tenant.organizationId
    }
  });
  if (!branch) return res.status(400).json({
    error: "branchId does not belong to this organization"
  });
  const counter = await prisma.serviceCounter.create({
    data: {
      organizationId: req.tenant.organizationId,
      branchId: BigInt(branchId),
      name
    }
  });
  return res.status(201).json({
    id: counter.id.toString(),
    organizationId: counter.organizationId.toString(),
    branchId: counter.branchId.toString(),
    name: counter.name,
    status: counter.status
  });
}
async function listCounters(req, res) {
  const branchId = req.query.branchId ? BigInt(req.query.branchId) : req.tenant.branchId;
  if (!branchId) return res.status(400).json({
    error: "branchId is required"
  });
  const counters = await prisma.serviceCounter.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      branchId
    },
    orderBy: {
      name: "asc"
    }
  });
  return res.json(counters.map(c => ({
    id: c.id.toString(),
    organizationId: c.organizationId.toString(),
    branchId: c.branchId.toString(),
    name: c.name,
    status: c.status
  })));
}
function todayDateOnly() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
async function fetchBoard(organizationId, branchId) {
  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId,
      branchId,
      status: {
        in: ["waiting", "called", "serving"]
      }
    },
    orderBy: [{
      priority: "desc"
    }, {
      createdAt: "asc"
    }],
    include: {
      customer: {
        select: {
          name: true
        }
      },
      service: {
        select: {
          name: true
        }
      }
    }
  });
  return tickets.map(serialize);
}
async function broadcastBoard(organizationId, branchId) {
  const board = await fetchBoard(organizationId, branchId);
  emitQueueUpdate(branchId.toString(), board);
}
async function checkIn(req, res) {
  const {
    bookingId,
    customerId,
    serviceId
  } = req.body;
  const branchId = req.tenant.branchId || (req.body.branchId ? BigInt(req.body.branchId) : null);
  if (!branchId) {
    return res.status(400).json({
      error: "branchId is required (or your account must be branch-scoped)"
    });
  }
  if (!customerId || !serviceId) {
    return res.status(400).json({
      error: "customerId and serviceId are required"
    });
  }
  const queueDate = todayDateOnly();
  const settings = await prisma.organizationSettings.findUnique({
    where: {
      organizationId: req.tenant.organizationId
    }
  });
  const prefix = settings?.queuePrefix || "Q";
  const ticket = await prisma.$transaction(async tx => {
    const countToday = await tx.queueTicket.count({
      where: {
        organizationId: req.tenant.organizationId,
        branchId,
        queueDate
      }
    });
    const ticketNumber = `${prefix}${String(countToday + 1).padStart(3, "0")}`;
    const newTicket = await tx.queueTicket.create({
      data: {
        uuid: randomUUID(),
        organizationId: req.tenant.organizationId,
        branchId,
        bookingId: bookingId ? BigInt(bookingId) : null,
        customerId: BigInt(customerId),
        serviceId: BigInt(serviceId),
        queueDate,
        ticketNumber,
        status: "waiting"
      }
    });
    await tx.queueHistory.create({
      data: {
        queueTicketId: newTicket.id,
        enteredQueueAt: new Date()
      }
    });
    if (bookingId) {
      await tx.booking.update({
        where: {
          id: BigInt(bookingId)
        },
        data: {
          status: "checked_in"
        }
      });
    }
    return newTicket;
  });
  const channel = await getPreferredChannel(req.tenant.organizationId);
  const trackingLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/track/${ticket.uuid}`;
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "customer",
    recipientId: BigInt(customerId),
    channel,
    message: `Your queue number is ${ticket.ticketNumber}. Track your position live: ${trackingLink}`
  });
  if (bookingId) {
    emitBookingUpdate(customerId);
  }
  await broadcastBoard(req.tenant.organizationId, branchId);
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "customer_joined_queue",
    entityType: "queue_ticket",
    entityId: ticket.id,
    metadata: {
      ticketNumber: ticket.ticketNumber
    }
  });
  return res.status(201).json(serialize(ticket));
}
async function callNext(req, res) {
  const {
    counterId
  } = req.body;
  if (!counterId) return res.status(400).json({
    error: "counterId is required"
  });
  const branchId = req.tenant.branchId;
  if (!branchId) return res.status(400).json({
    error: "Your account must be branch-scoped to call tickets"
  });
  const nextTicket = await prisma.queueTicket.findFirst({
    where: {
      organizationId: req.tenant.organizationId,
      branchId,
      status: "waiting"
    },
    orderBy: [{
      priority: "desc"
    }, {
      createdAt: "asc"
    }]
  });
  if (!nextTicket) {
    return res.status(404).json({
      error: "No customers waiting"
    });
  }
  const updated = await prisma.$transaction(async tx => {
    const t = await tx.queueTicket.update({
      where: {
        id: nextTicket.id
      },
      data: {
        status: "called",
        calledAt: new Date(),
        counterId: BigInt(counterId),
        handledByUserId: BigInt(req.auth.userId)
      }
    });
    await tx.queueHistory.upsert({
      where: {
        queueTicketId: nextTicket.id
      },
      update: {
        calledAt: new Date()
      },
      create: {
        queueTicketId: nextTicket.id,
        enteredQueueAt: nextTicket.createdAt,
        calledAt: new Date()
      }
    });
    return t;
  });
  const channel = await getPreferredChannel(req.tenant.organizationId);
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "customer",
    recipientId: nextTicket.customerId,
    channel,
    message: `You're being called! Please proceed to the counter — ticket ${nextTicket.ticketNumber}.`
  });
  await broadcastBoard(req.tenant.organizationId, branchId);
  return res.json(serialize(updated));
}
async function markServing(req, res) {
  const ticketId = BigInt(req.params.id);
  const ticket = await prisma.queueTicket.findFirst({
    where: {
      id: ticketId,
      organizationId: req.tenant.organizationId
    }
  });
  if (!ticket) return res.status(404).json({
    error: "Ticket not found"
  });
  const updated = await prisma.$transaction(async tx => {
    const t = await tx.queueTicket.update({
      where: {
        id: ticketId
      },
      data: {
        status: "serving"
      }
    });
    await tx.queueHistory.upsert({
      where: {
        queueTicketId: ticketId
      },
      update: {
        serviceStartAt: new Date()
      },
      create: {
        queueTicketId: ticketId,
        enteredQueueAt: ticket.createdAt,
        serviceStartAt: new Date()
      }
    });
    return t;
  });
  await broadcastBoard(req.tenant.organizationId, ticket.branchId);
  return res.json(serialize(updated));
}
async function completeTicket(req, res) {
  const ticketId = BigInt(req.params.id);
  const ticket = await prisma.queueTicket.findFirst({
    where: {
      id: ticketId,
      organizationId: req.tenant.organizationId
    }
  });
  if (!ticket) return res.status(404).json({
    error: "Ticket not found"
  });
  const history = await prisma.queueHistory.findUnique({
    where: {
      queueTicketId: ticketId
    }
  });
  const now = new Date();
  const waitTimeSeconds = history?.calledAt ? Math.round((history.calledAt.getTime() - history.enteredQueueAt.getTime()) / 1000) : null;
  const serviceTimeSeconds = history?.serviceStartAt ? Math.round((now.getTime() - history.serviceStartAt.getTime()) / 1000) : null;
  const updated = await prisma.$transaction(async tx => {
    const t = await tx.queueTicket.update({
      where: {
        id: ticketId
      },
      data: {
        status: "completed"
      }
    });
    await tx.queueHistory.upsert({
      where: {
        queueTicketId: ticketId
      },
      update: {
        completedAt: now,
        waitTimeSeconds,
        serviceTimeSeconds
      },
      create: {
        queueTicketId: ticketId,
        enteredQueueAt: ticket.createdAt,
        completedAt: now,
        waitTimeSeconds,
        serviceTimeSeconds
      }
    });
    if (ticket.bookingId) {
      await tx.booking.update({
        where: {
          id: ticket.bookingId
        },
        data: {
          status: "completed"
        }
      });
    }
    return t;
  });
  await broadcastBoard(req.tenant.organizationId, ticket.branchId);
  if (ticket.bookingId) {
    const completionChannel = await getPreferredChannel(req.tenant.organizationId);
    notifyInBackground({
      organizationId: req.tenant.organizationId,
      recipientType: "customer",
      recipientId: ticket.customerId,
      channel: completionChannel,
      message: "Thank you for choosing us — your visit is complete. We hope to see you again soon!"
    });
    emitBookingUpdate(ticket.customerId);
  }
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "service_completed",
    entityType: "queue_ticket",
    entityId: ticket.id,
    metadata: {
      ticketNumber: ticket.ticketNumber
    }
  });
  return res.json(serialize(updated));
}
async function markMissed(req, res) {
  const ticketId = BigInt(req.params.id);
  const ticket = await prisma.queueTicket.findFirst({
    where: {
      id: ticketId,
      organizationId: req.tenant.organizationId
    }
  });
  if (!ticket) return res.status(404).json({
    error: "Ticket not found"
  });
  if (ticket.status !== "called") {
    return res.status(400).json({
      error: `Only a called ticket can be marked missed (this one is currently ${ticket.status})`
    });
  }
  const history = await prisma.queueHistory.findUnique({
    where: {
      queueTicketId: ticketId
    }
  });
  const waitTimeSeconds = history?.calledAt ? Math.round((history.calledAt.getTime() - history.enteredQueueAt.getTime()) / 1000) : null;
  const updated = await prisma.$transaction(async tx => {
    const t = await tx.queueTicket.update({
      where: {
        id: ticketId
      },
      data: {
        status: "missed"
      }
    });
    await tx.queueHistory.upsert({
      where: {
        queueTicketId: ticketId
      },
      update: {
        completedAt: new Date(),
        waitTimeSeconds
      },
      create: {
        queueTicketId: ticketId,
        enteredQueueAt: ticket.createdAt,
        completedAt: new Date(),
        waitTimeSeconds
      }
    });
    return t;
  });
  await broadcastBoard(req.tenant.organizationId, ticket.branchId);
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "customer_missed",
    entityType: "queue_ticket",
    entityId: ticket.id,
    metadata: {
      ticketNumber: ticket.ticketNumber
    }
  });
  return res.json(serialize(updated));
}
async function liveBoard(req, res) {
  const branchId = req.query.branchId ? BigInt(req.query.branchId) : req.tenant.branchId;
  if (!branchId) return res.status(400).json({
    error: "branchId is required"
  });
  const board = await fetchBoard(req.tenant.organizationId, branchId);
  return res.json(board);
}
async function averageServiceTimeSeconds(organizationId, branchId) {
  const todayStart = todayDateOnly();
  const todayAvg = await prisma.queueHistory.aggregate({
    _avg: {
      serviceTimeSeconds: true
    },
    where: {
      serviceTimeSeconds: {
        not: null
      },
      queueTicket: {
        organizationId,
        branchId,
        queueDate: todayStart
      }
    }
  });
  if (todayAvg._avg.serviceTimeSeconds != null) return Math.round(todayAvg._avg.serviceTimeSeconds);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekAvg = await prisma.queueHistory.aggregate({
    _avg: {
      serviceTimeSeconds: true
    },
    where: {
      serviceTimeSeconds: {
        not: null
      },
      queueTicket: {
        organizationId,
        branchId,
        queueDate: {
          gte: weekAgo
        }
      }
    }
  });
  if (weekAvg._avg.serviceTimeSeconds != null) return Math.round(weekAvg._avg.serviceTimeSeconds);
  return 600;
}
async function computeEstimate(organizationId, branchId, ticket) {
  if (["completed", "cancelled", "missed"].includes(ticket.status)) {
    return {
      customersAhead: null,
      estimatedWaitSeconds: null,
      estimatedArrivalTime: null
    };
  }
  if (ticket.status === "called" || ticket.status === "serving") {
    return {
      customersAhead: 0,
      estimatedWaitSeconds: 0,
      estimatedArrivalTime: new Date().toISOString()
    };
  }
  const [customersAhead, activeCounters, avgServiceTimeSeconds] = await Promise.all([prisma.queueTicket.count({
    where: {
      organizationId,
      branchId,
      status: "waiting",
      OR: [{
        priority: {
          gt: ticket.priority
        }
      }, {
        priority: ticket.priority,
        createdAt: {
          lt: ticket.createdAt
        }
      }]
    }
  }), prisma.serviceCounter.count({
    where: {
      organizationId,
      branchId,
      status: "open"
    }
  }), averageServiceTimeSeconds(organizationId, branchId)]);
  const counters = Math.max(activeCounters, 1);
  const roundsAhead = Math.ceil((customersAhead + 1) / counters);
  const estimatedWaitSeconds = roundsAhead * avgServiceTimeSeconds;
  return {
    customersAhead,
    estimatedWaitSeconds,
    estimatedArrivalTime: new Date(Date.now() + estimatedWaitSeconds * 1000).toISOString()
  };
}
async function trackTicket(req, res) {
  const ticket = await prisma.queueTicket.findUnique({
    where: {
      uuid: req.params.uuid
    },
    include: {
      customer: {
        select: {
          name: true
        }
      },
      service: {
        select: {
          name: true
        }
      },
      branch: {
        select: {
          name: true
        }
      },
      organization: {
        select: {
          name: true
        }
      }
    }
  });
  if (!ticket) return res.status(404).json({
    error: "Tracking link not found or expired"
  });
  const estimate = await computeEstimate(ticket.organizationId, ticket.branchId, ticket);
  const nowServing = await prisma.queueTicket.findFirst({
    where: {
      organizationId: ticket.organizationId,
      branchId: ticket.branchId,
      status: "serving"
    },
    orderBy: {
      updatedAt: "desc"
    },
    select: {
      ticketNumber: true
    }
  });
  const customersCompletedToday = await prisma.queueTicket.count({
    where: {
      organizationId: ticket.organizationId,
      branchId: ticket.branchId,
      queueDate: ticket.queueDate,
      status: "completed"
    }
  });
  return res.json({
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    customerName: ticket.customer.name,
    serviceName: ticket.service.name,
    branchId: ticket.branchId.toString(),
    branchName: ticket.branch.name,
    organizationName: ticket.organization.name,
    nowServingTicketNumber: nowServing?.ticketNumber || null,
    customersCompletedToday,
    ...estimate
  });
}
function serialize(ticket) {
  return toJSONSafe(ticket);
}
module.exports = {
  checkIn,
  callNext,
  markServing,
  completeTicket,
  markMissed,
  liveBoard,
  trackTicket,
  createCounter,
  listCounters
};