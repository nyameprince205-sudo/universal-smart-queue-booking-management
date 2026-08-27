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
  waitlisted: ["pending", "cancelled"],
  cancelled: [],
  completed: [],
  no_show: []
};
const SLOT_OCCUPYING_STATUSES = ["pending", "confirmed", "checked_in"];
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
  const normalizedDate = String(bookingDate).slice(0, 10);
  const normalizedTime = String(bookingTime).length === 5 ? `${bookingTime}:00` : String(bookingTime).slice(0, 8);
  const booking = await prisma.$transaction(async tx => {
    const [lockedService] = await tx.$queryRaw`
      SELECT capacity_per_slot, when_full FROM services WHERE id = ${serviceId} FOR UPDATE
    `;
    const duplicates = await tx.$queryRaw`
      SELECT id FROM bookings
      WHERE customer_id = ${customerId}
        AND service_id = ${serviceId}
        AND booking_date = ${normalizedDate}
        AND booking_time = ${normalizedTime}
        AND status IN ('pending', 'confirmed', 'checked_in', 'waitlisted')
      LIMIT 1
    `;
    if (duplicates.length > 0) {
      throw httpError(409, "You already have a booking for this service at that time. Increase the party size if you're booking for more people.");
    }
    const rawCapacity = lockedService?.capacity_per_slot;
    const capacity = rawCapacity === null || rawCapacity === undefined ? null : Number(rawCapacity);
    let status = "pending";
    if (capacity !== null) {
      const [{
        taken
      }] = await tx.$queryRaw`
        SELECT COUNT(*) AS taken FROM bookings
        WHERE service_id = ${serviceId}
          AND booking_date = ${normalizedDate}
          AND booking_time = ${normalizedTime}
          AND status IN ('pending', 'confirmed', 'checked_in')
      `;
      if (Number(taken) >= capacity) {
        const whenFull = lockedService?.when_full || "waitlist";
        if (whenFull === "reject") {
          throw httpError(409, "That time is already fully booked. Please choose another time or date — or another branch if this business has more than one.");
        }
        status = "waitlisted";
      }
    }
    const created = await tx.booking.create({
      data: {
        uuid: randomUUID(),
        organizationId,
        branchId,
        customerId,
        serviceId,
        bookingDate: new Date(bookingDate),
        bookingTime: new Date(`1970-01-01T${normalizedTime}Z`),
        partySize: partySize || 1,
        notes: notes || null,
        status
      }
    });
    if (status === "waitlisted") {
      const [{
        ahead
      }] = await tx.$queryRaw`
        SELECT COUNT(*) AS ahead FROM bookings
        WHERE service_id = ${serviceId}
          AND booking_date = ${normalizedDate}
          AND booking_time = ${normalizedTime}
          AND status = 'waitlisted'
          AND id < ${created.id}
      `;
      created.waitlistPosition = Number(ahead) + 1;
    }
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
  const message = booking.status === "waitlisted" ? `That slot is currently full, so you're on the waitlist for ${bookingDate} at ${bookingTime}. We'll message you straight away if a place opens up.` : `Your booking for ${bookingDate} at ${bookingTime} has been received and is pending confirmation.`;
  notifyInBackground({
    organizationId,
    recipientType: "customer",
    recipientId: customerId,
    channel,
    message
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
  if (["cancelled", "no_show", "completed"].includes(nextStatus)) {
    promoteFromWaitlist(booking);
  }
  return res.json(serialize(updated));
}
async function promoteFromWaitlist(freedBooking) {
  try {
    const service = await prisma.service.findUnique({
      where: {
        id: freedBooking.serviceId
      },
      select: {
        capacityPerSlot: true,
        whenFull: true
      }
    });
    if (service?.whenFull === "reject") return;
    if (!service || service.capacityPerSlot === null) return;
    const dateStr = freedBooking.bookingDate.toISOString().slice(0, 10);
    const timeStr = freedBooking.bookingTime.toISOString().slice(11, 19);
    const [{
      taken
    }] = await prisma.$queryRaw`
      SELECT COUNT(*) AS taken FROM bookings
      WHERE service_id = ${freedBooking.serviceId}
        AND booking_date = ${dateStr}
        AND booking_time = ${timeStr}
        AND status IN ('pending', 'confirmed', 'checked_in')
    `;
    if (Number(taken) >= Number(service.capacityPerSlot)) return;
    const nextRows = await prisma.$queryRaw`
      SELECT id FROM bookings
      WHERE service_id = ${freedBooking.serviceId}
        AND booking_date = ${dateStr}
        AND booking_time = ${timeStr}
        AND status = 'waitlisted'
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (nextRows.length === 0) return;
    const next = await prisma.booking.findUnique({
      where: {
        id: BigInt(nextRows[0].id)
      }
    });
    if (!next) return;
    await prisma.booking.update({
      where: {
        id: next.id
      },
      data: {
        status: "pending"
      }
    });
    const channel = await getPreferredChannel(next.organizationId);
    notifyInBackground({
      organizationId: next.organizationId,
      recipientType: "customer",
      recipientId: next.customerId,
      channel,
      message: `Good news — a place has opened up and your booking for ${dateStr} is now confirmed. See you then!`
    });
    logActivity({
      organizationId: next.organizationId,
      userId: null,
      action: "booking_promoted_from_waitlist",
      entityType: "booking",
      entityId: next.id,
      metadata: null
    });
  } catch (err) {
    console.error("[waitlist] promotion failed:", err.message);
  }
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
  promoteFromWaitlist(booking);
  return res.json(serialize(updated));
}
function serialize(booking) {
  return toJSONSafe(booking);
}
module.exports = {
  listBookings,
  createBooking,
  createBookingCore,
  createMyBooking,
  createGuestBooking,
  listMyBookings,
  updateBookingStatus,
  cancelMyBooking,
  promoteFromWaitlist
};