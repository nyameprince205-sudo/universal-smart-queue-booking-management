const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
function serializeTicket(ticket) {
  return toJSONSafe({
    ...ticket,
    messages: ticket.messages?.map(m => ({
      id: m.id,
      senderType: m.senderType,
      senderId: m.senderId,
      senderName: m.senderName,
      message: m.message,
      createdAt: m.createdAt
    }))
  });
}
async function getSenderName(senderType, senderId) {
  if (senderType === "customer") {
    const c = await prisma.customer.findUnique({
      where: {
        id: senderId
      },
      select: {
        name: true
      }
    });
    return c?.name || "Customer";
  }
  const u = await prisma.user.findUnique({
    where: {
      id: senderId
    },
    select: {
      name: true
    }
  });
  return u?.name || "User";
}
async function createTicket(req, res) {
  const {
    subject,
    message
  } = req.body;
  if (!subject || !message) {
    return res.status(400).json({
      error: "subject and message are required"
    });
  }
  const role = req.auth.role;
  const senderId = BigInt(req.auth.userId);
  let fromType, toType, organizationId;
  if (role === "CUSTOMER") {
    fromType = "customer";
    toType = "org_admin";
    const orgId = req.body.organizationId;
    if (!orgId) return res.status(400).json({
      error: "organizationId is required for customer tickets"
    });
    organizationId = BigInt(orgId);
  } else if (role === "STAFF") {
    fromType = "staff";
    toType = "org_admin";
    organizationId = BigInt(req.auth.organizationId);
  } else if (role === "ORG_ADMIN") {
    fromType = "org_admin";
    toType = "super_admin";
    organizationId = BigInt(req.auth.organizationId);
  } else {
    throw httpError(403, "Your role cannot create support tickets");
  }
  const senderName = await getSenderName(fromType, senderId);
  const ticket = await prisma.supportTicket.create({
    data: {
      subject,
      fromType,
      fromId: senderId,
      toType,
      organizationId: organizationId || null,
      messages: {
        create: {
          senderType: fromType,
          senderId,
          senderName,
          message
        }
      }
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
  return res.status(201).json(serializeTicket(ticket));
}
async function listMyTickets(req, res) {
  const role = req.auth.role;
  const userId = BigInt(req.auth.userId);
  let where;
  if (role === "CUSTOMER") {
    where = {
      fromType: "customer",
      fromId: userId
    };
  } else if (role === "STAFF") {
    where = {
      fromType: "staff",
      fromId: userId
    };
  } else if (role === "ORG_ADMIN") {
    where = {
      fromType: "org_admin",
      fromId: userId
    };
  } else {
    throw httpError(403, "Forbidden");
  }
  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: {
      updatedAt: "desc"
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
  return res.json(tickets.map(serializeTicket));
}
async function listInboxTickets(req, res) {
  const role = req.auth.role;
  let where;
  if (role === "ORG_ADMIN") {
    where = {
      toType: "org_admin",
      organizationId: BigInt(req.auth.organizationId)
    };
  } else if (role === "SUPER_ADMIN") {
    where = {
      toType: "super_admin"
    };
  } else {
    throw httpError(403, "Forbidden");
  }
  if (req.query.status) where.status = req.query.status;
  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: {
      updatedAt: "desc"
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
  return res.json(tickets.map(serializeTicket));
}
async function getTicket(req, res) {
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: BigInt(req.params.id)
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
  if (!ticket) throw httpError(404, "Ticket not found");
  const role = req.auth.role;
  const userId = BigInt(req.auth.userId);
  const canAccess = role === "CUSTOMER" && ticket.fromType === "customer" && ticket.fromId === userId || role === "STAFF" && ticket.fromType === "staff" && ticket.fromId === userId || role === "ORG_ADMIN" && (ticket.fromType === "org_admin" && ticket.fromId === userId || ticket.toType === "org_admin" && ticket.organizationId === BigInt(req.auth.organizationId)) || role === "SUPER_ADMIN" && ticket.toType === "super_admin";
  if (!canAccess) throw httpError(403, "You do not have access to this ticket");
  return res.json(serializeTicket(ticket));
}
async function replyToTicket(req, res) {
  const {
    message
  } = req.body;
  if (!message) return res.status(400).json({
    error: "message is required"
  });
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  if (!ticket) throw httpError(404, "Ticket not found");
  if (ticket.status === "resolved") throw httpError(400, "This ticket is already resolved");
  const role = req.auth.role;
  const userId = BigInt(req.auth.userId);
  const canReply = role === "CUSTOMER" && ticket.fromType === "customer" && ticket.fromId === userId || role === "STAFF" && ticket.fromType === "staff" && ticket.fromId === userId || role === "ORG_ADMIN" && (ticket.fromType === "org_admin" && ticket.fromId === userId || ticket.toType === "org_admin" && ticket.organizationId === BigInt(req.auth.organizationId)) || role === "SUPER_ADMIN" && ticket.toType === "super_admin";
  if (!canReply) throw httpError(403, "You cannot reply to this ticket");
  let senderType;
  if (role === "CUSTOMER") senderType = "customer";else if (role === "STAFF") senderType = "staff";else if (role === "ORG_ADMIN") senderType = "org_admin";else senderType = "super_admin";
  const senderName = await getSenderName(senderType === "super_admin" ? "user" : senderType, userId);
  const [newMessage] = await prisma.$transaction([prisma.supportMessage.create({
    data: {
      ticketId: ticket.id,
      senderType,
      senderId: userId,
      senderName,
      message
    }
  }), prisma.supportTicket.update({
    where: {
      id: ticket.id
    },
    data: {
      status: "in_progress",
      updatedAt: new Date()
    }
  })]);
  return res.status(201).json(toJSONSafe(newMessage));
}
async function resolveTicket(req, res) {
  const ticket = await prisma.supportTicket.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  if (!ticket) throw httpError(404, "Ticket not found");
  const role = req.auth.role;
  const canResolve = role === "ORG_ADMIN" && ticket.toType === "org_admin" && ticket.organizationId === BigInt(req.auth.organizationId) || role === "SUPER_ADMIN" && ticket.toType === "super_admin";
  if (!canResolve) throw httpError(403, "Only the recipient can resolve a ticket");
  const updated = await prisma.supportTicket.update({
    where: {
      id: ticket.id
    },
    data: {
      status: "resolved"
    }
  });
  return res.json(toJSONSafe(updated));
}
module.exports = {
  createTicket,
  listMyTickets,
  listInboxTickets,
  getTicket,
  replyToTicket,
  resolveTicket
};