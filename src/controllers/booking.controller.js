const prisma = require("../config/db");
const { randomUUID } = require("crypto");

// A booking's status is a proper state machine, not a free-for-all field.
// This table is the single source of truth for "what can become what" —
// every write to `status` in this file goes through canTransition() first,
// so the rule lives in exactly one place instead of being re-implemented
// (and potentially re-implemented WRONG) in every route that touches it.
//
// Notice `checked_in` isn't reachable from here at all — that transition
// deliberately only happens through the queue check-in flow (Phase 11),
// because a booking becoming checked_in should always mean a real queue
// ticket now exists for it, not just a status field flipping in isolation.
const ALLOWED_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["cancelled", "no_show"], // checked_in happens via check-in, not this endpoint
  checked_in: ["completed", "cancelled"],
  cancelled: [], // terminal
  completed: [], // terminal
  no_show: [], // terminal
};

function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// Shared core used by BOTH creation paths below — the only difference
// between "staff books on a customer's behalf" and "a customer books for
// themselves" is WHERE organizationId and customerId come from, not what
// happens once we have them. Keeping that logic in one place means a bug
// fix here fixes both paths at once.
async function createBookingCore({ organizationId, branchId, customerId, serviceId, bookingDate, bookingTime, partySize, notes }) {
  // Validate that the branch and service actually belong to the claimed
  // organization. This matters most on the customer self-service path —
  // a customer supplies organizationId/branchId/serviceId directly in the
  // request body (they have no tenant middleware scoping it for them), so
  // without this check a malicious request could mix IDs from different
  // organizations and create a nonsensical (or exploitable) booking.
  const [branch, service] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId } }),
    prisma.service.findFirst({ where: { id: serviceId, organizationId } }),
  ]);
  if (!branch) throw httpError(400, "branchId does not belong to this organization");
  if (!service) throw httpError(400, "serviceId does not belong to this organization");

  const booking = await prisma.$transaction(async (tx) => {
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
        status: "pending",
      },
    });

    // Cached aggregate pattern (see DATABASE_DESIGN.md Section 5) — kept
    // as an upsert rather than a raw COUNT(*) on every dashboard load.
    await tx.customerOrganization.upsert({
      where: { uq_customer_org: { customerId, organizationId } },
      update: { totalBookings: { increment: 1 }, lastInteractionAt: new Date() },
      create: {
        customerId,
        organizationId,
        firstInteractionAt: new Date(),
        lastInteractionAt: new Date(),
        totalBookings: 1,
      },
    });

    return created;
  });

  return booking;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---- Staff / Org Admin: create a booking on a customer's behalf ----
async function createBooking(req, res) {
  const { branchId, customerId, serviceId, bookingDate, bookingTime, partySize, notes } = req.body;

  if (!branchId || !customerId || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({
      error: "branchId, customerId, serviceId, bookingDate, and bookingTime are required",
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
  });

  return res.status(201).json(serialize(booking));
}

// ---- Customer: book for themselves ----
// No req.tenant here at all — customer routes aren't tenant-scoped, so the
// organization they want to book with is explicit input, validated by
// createBookingCore's branch/service ownership check above.
async function createMyBooking(req, res) {
  const { organizationId, branchId, serviceId, bookingDate, bookingTime, partySize, notes } = req.body;

  if (!organizationId || !branchId || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({
      error: "organizationId, branchId, serviceId, bookingDate, and bookingTime are required",
    });
  }

  const booking = await createBookingCore({
    organizationId: BigInt(organizationId),
    branchId: BigInt(branchId),
    customerId: BigInt(req.auth.userId), // <- the customer's OWN id from their JWT, never trusted from the body
    serviceId: BigInt(serviceId),
    bookingDate,
    bookingTime,
    partySize,
    notes,
  });

  return res.status(201).json(serialize(booking));
}

// ---- Staff / Org Admin: view bookings for their organization ----
async function listBookings(req, res) {
  const { date } = req.query;

  const where = { organizationId: req.tenant.organizationId };
  if (req.tenant.branchId) where.branchId = req.tenant.branchId;
  if (date) where.bookingDate = new Date(date);

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: [{ bookingDate: "asc" }, { bookingTime: "asc" }],
    include: { customer: { select: { name: true, phone: true } }, service: { select: { name: true } } },
  });

  return res.json(bookings.map(serialize));
}

// ---- Customer: view their OWN bookings, across every organization ----
async function listMyBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { customerId: BigInt(req.auth.userId) },
    orderBy: [{ bookingDate: "desc" }],
    include: {
      organization: { select: { name: true } },
      branch: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  return res.json(bookings.map(serialize));
}

// ---- Staff / Org Admin: move a booking through its lifecycle ----
async function updateBookingStatus(req, res) {
  const { status: nextStatus } = req.body;

  const booking = await prisma.booking.findFirst({
    where: { id: BigInt(req.params.id), organizationId: req.tenant.organizationId },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  if (!canTransition(booking.status, nextStatus)) {
    return res.status(400).json({
      error: `Cannot move a booking from "${booking.status}" to "${nextStatus}"`,
      allowedNextStatuses: ALLOWED_TRANSITIONS[booking.status] || [],
    });
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: nextStatus },
  });

  return res.json(serialize(updated));
}

// ---- Customer: cancel their OWN booking ----
// A narrower, safer action than the staff endpoint above — a customer can
// only ever move their own booking to "cancelled", never any other status,
// and only if it's still in a cancellable state.
async function cancelMyBooking(req, res) {
  const booking = await prisma.booking.findFirst({
    where: { id: BigInt(req.params.id), customerId: BigInt(req.auth.userId) },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  if (!canTransition(booking.status, "cancelled")) {
    return res.status(400).json({
      error: `A booking that is "${booking.status}" can no longer be cancelled`,
    });
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "cancelled" },
  });

  return res.json(serialize(updated));
}

function serialize(booking) {
  return {
    ...booking,
    id: booking.id.toString(),
    organizationId: booking.organizationId.toString(),
    branchId: booking.branchId.toString(),
    customerId: booking.customerId ? booking.customerId.toString() : undefined,
    serviceId: booking.serviceId ? booking.serviceId.toString() : undefined,
  };
}

module.exports = {
  listBookings,
  createBooking,
  createMyBooking,
  listMyBookings,
  updateBookingStatus,
  cancelMyBooking,
};
