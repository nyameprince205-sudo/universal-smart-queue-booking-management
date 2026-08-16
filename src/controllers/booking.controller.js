const prisma = require("../config/db");
const {
  randomUUID
} = require("crypto");
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
const ALLOWED_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["cancelled", "no_show"],
  checked_in: ["completed", "cancelled"],
  cancelled: [],
  completed: [],
  no_show: []
};
function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}
async function createBookingCore({
  organizationId,
  branchId,
  customerId,
  serviceId,
  bookingDate,
  bookingTime,
  partySize,
  notes,
  performedByUserId
}) {
  const [branch, service] = await Promise.all([prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId
    }
  }), prisma.service.findFirst({
    where: {
      id: serviceId,
      organizationId
    }
  })]);
  if (!branch) throw httpError(400, "branchId does not belong to this organization");
  if (!service) throw httpError(400, "serviceId does not belong to this organization");
  const booking = await prisma.$transaction(async tx => {
    const created = await tx.booking.create({
      data: {
        uuid: randomUUID(),
        organizationId,
        branchId,
        customerId,
        serviceId,
        bookingDate: new Date(bookingDate),
        bookingTime: new Date(`1970-01-01T${bookingTime}Z`),
        partySize: partySize || 1,
        notes: notes || null,
        status: "pending"
      }
    });
    await tx.customerOrganization.upsert({
      where: {
        uq_customer_org: {
          customerId,
          organizationId
        }
      },
      update: {
        totalBookings: {
          increment: 1
        },
        lastInteractionAt: new Date()
      },
      create: {
        customerId,
        organizationId,
        firstInteractionAt: new Date(),
        lastInteractionAt: new Date(),
        totalBookings: 1
      }
    });
    return created;
  });
  const channel = await getPreferredChannel(organizationId);
  notifyInBackground({
    organizationId,
    recipientType: "customer",
    recipientId: customerId,
    channel,
    message: `Your booking for ${bookingDate} at ${bookingTime} has been received and is pending confirmation.`
  });
  logActivity({
    organizationId,
    userId: performedByUserId || null,
    action: "booking_created",
    entityType: "booking",
    entityId: booking.id,
    metadata: {
      bookingDate,
      bookingTime
    }
  });
  return booking;
}
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
async function createBooking(req, res) {
  const {
    branchId,
    customerId,
    serviceId,
    bookingDate,
    bookingTime,
    partySize,
    notes
  } = req.body;
  if (!branchId || !customerId || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({
      error: "branchId, customerId, serviceId, bookingDate, and bookingTime are required"
    });
  }
  const booking = await createBookingCore({
    organizationId: req.tenant.organizationId,
    branchId: BigInt(branchId),
    customerId: BigInt(customerId),
    serviceId: BigInt(serviceId),
    bookingDate,
    bookingTime,
    partySize,
    notes,
    performedByUserId: req.auth?.userId ? BigInt(req.auth.userId) : null
  });
  return res.status(201).json(serialize(booking));
}
async function createGuestBooking(req, res) {
  const {
    organizationId,
    branchId,
    serviceId,
    bookingDate,
    bookingTime,
    partySize,
    notes,
    customerName,
    customerPhone,
    customerEmail
  } = req.body;
  if (!organizationId || !branchId || !serviceId || !bookingDate || !bookingTime || !customerName || !customerPhone) {
    return res.status(400).json({
      error: "organizationId, branchId, serviceId, bookingDate, bookingTime, customerName, and customerPhone are required"
    });
  }
  let customer = await prisma.customer.findUnique({
    where: {
      phone: customerPhone
    }
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        uuid: randomUUID(),
        name: customerName,
        phone: customerPhone,
        email: customerEmail || null,
        status: "active"
      }
    });
  }
  const booking = await createBookingCore({
    organizationId: BigInt(organizationId),
    branchId: BigInt(branchId),
    customerId: customer.id,
    serviceId: BigInt(serviceId),
    bookingDate,
    bookingTime,
    partySize,
    notes
  });
  return res.status(201).json(serialize(booking));
}
async function createMyBooking(req, res) {
  const {
    organizationId,
    branchId,
    serviceId,
    bookingDate,
    bookingTime,
    partySize,
    notes
  } = req.body;
  if (!organizationId || !branchId || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({
      error: "organizationId, branchId, serviceId, bookingDate, and bookingTime are required"
    });
  }
  const booking = await createBookingCore({
    organizationId: BigInt(organizationId),
    branchId: BigInt(branchId),
    customerId: BigInt(req.auth.userId),
    serviceId: BigInt(serviceId),
    bookingDate,
    bookingTime,
    partySize,
    notes
  });
  return res.status(201).json(serialize(booking));
}
async function listBookings(req, res) {
  const {
    date
  } = req.query;
  const where = {
    organizationId: req.tenant.organizationId
  };
  if (req.tenant.branchId) {
    where.branchId = req.tenant.branchId;
  } else if (req.query.branchId) {
    where.branchId = BigInt(req.query.branchId);
  }
  if (date) where.bookingDate = new Date(date);
  const bookings = await prisma.booking.findMany({
    where,
    orderBy: [{
      bookingDate: "asc"
    }, {
      bookingTime: "asc"
    }],
    include: {
      customer: {
        select: {
          name: true,
          phone: true
        }
      },
      service: {
        select: {
          name: true
        }
      }
    }
  });
  return res.json(bookings.map(serialize));
}
async function listMyBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: {
      customerId: BigInt(req.auth.userId)
    },
    orderBy: [{
      bookingDate: "desc"
    }],
    include: {
      organization: {
        select: {
          name: true
        }
      },
      branch: {
        select: {
          name: true
        }
      },
      service: {
        select: {
          name: true
        }
      },
      queueTickets: {
        orderBy: {
          createdAt: "desc"
        },
        take: 1,
        select: {
          uuid: true,
          status: true,
          ticketNumber: true
        }
      }
    }
  });
  return res.json(bookings.map(serialize));
}
async function updateBookingStatus(req, res) {
  const {
    status: nextStatus
  } = req.body;
  const booking = await prisma.booking.findFirst({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId
    }
  });
  if (!booking) return res.status(404).json({
    error: "Booking not found"
  });
  if (!canTransition(booking.status, nextStatus)) {
    return res.status(400).json({
      error: `Cannot move a booking from "${booking.status}" to "${nextStatus}"`,
      allowedNextStatuses: ALLOWED_TRANSITIONS[booking.status] || []
    });
  }
  const updated = await prisma.booking.update({
    where: {
      id: booking.id
    },
    data: {
      status: nextStatus
    }
  });
  if (nextStatus === "completed") {
    logActivity({
      organizationId: req.tenant.organizationId,
      userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
      action: "appointment_completed",
      entityType: "booking",
      entityId: booking.id,
      metadata: null
    });
  }
  return res.json(serialize(updated));
}
async function cancelMyBooking(req, res) {
  const booking = await prisma.booking.findFirst({
    where: {
      id: BigInt(req.params.id),
      customerId: BigInt(req.auth.userId)
    }
  });
  if (!booking) return res.status(404).json({
    error: "Booking not found"
  });
  if (!canTransition(booking.status, "cancelled")) {
    return res.status(400).json({
      error: `A booking that is "${booking.status}" can no longer be cancelled`
    });
  }
  const updated = await prisma.booking.update({
    where: {
      id: booking.id
    },
    data: {
      status: "cancelled"
    }
  });
  logActivity({
    organizationId: booking.organizationId,
    userId: null,
    action: "booking_cancelled",
    entityType: "booking",
    entityId: booking.id,
    metadata: null
  });
  return res.json(serialize(updated));
}
function serialize(booking) {
  return toJSONSafe(booking);
}
module.exports = {
  listBookings,
  createBooking,
  createMyBooking,
  createGuestBooking,
  listMyBookings,
  updateBookingStatus,
  cancelMyBooking
};