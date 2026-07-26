const prisma = require("../config/db");

async function listBookings(req, res) {
  const { date } = req.query; // optional ?date=2026-07-24 filter — the "today's bookings" dashboard query

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

async function createBooking(req, res) {
  const { branchId, customerId, serviceId, bookingDate, bookingTime, partySize, notes } = req.body;

  if (!branchId || !customerId || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({
      error: "branchId, customerId, serviceId, bookingDate, and bookingTime are required",
    });
  }

  const booking = await prisma.booking.create({
    data: {
      organizationId: req.tenant.organizationId,
      branchId: BigInt(branchId),
      customerId: BigInt(customerId),
      serviceId: BigInt(serviceId),
      bookingDate: new Date(bookingDate),
      bookingTime: new Date(`1970-01-01T${bookingTime}Z`),
      partySize: partySize || 1,
      notes: notes || null,
      status: "pending",
    },
  });

  // Bump the customer_organizations relationship counter — a good example
  // of the "cached aggregate" pattern explained in DATABASE_DESIGN.md
  // Section 5. Kept as a straightforward upsert rather than a raw COUNT(*)
  // on every dashboard page load.
  await prisma.customerOrganization.upsert({
    where: {
      customerId_organizationId: {
        customerId: BigInt(customerId),
        organizationId: req.tenant.organizationId,
      },
    },
    update: {
      totalBookings: { increment: 1 },
      lastInteractionAt: new Date(),
    },
    create: {
      customerId: BigInt(customerId),
      organizationId: req.tenant.organizationId,
      firstInteractionAt: new Date(),
      lastInteractionAt: new Date(),
      totalBookings: 1,
    },
  });

  return res.status(201).json(serialize(booking));
}

async function updateBookingStatus(req, res) {
  const { status } = req.body;
  const allowed = ["pending", "confirmed", "checked_in", "cancelled", "completed", "no_show"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  const result = await prisma.booking.updateMany({
    where: { id: BigInt(req.params.id), organizationId: req.tenant.organizationId },
    data: { status },
  });

  if (result.count === 0) return res.status(404).json({ error: "Booking not found" });

  const updated = await prisma.booking.findUnique({ where: { id: BigInt(req.params.id) } });
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

module.exports = { listBookings, createBooking, updateBookingStatus };
