const prisma = require("../config/db");

// This file is the heart of the whole product. Read the comments closely —
// this is the part worth understanding deeply, not just copying.

function todayDateOnly() {
  // MySQL DATE columns don't care about time-of-day, so we normalize to
  // midnight UTC here. In production you'd use the organization's configured
  // timezone (organization_settings.timezone) instead of the server's — left
  // as a deliberate simplification for now; note it as a known TODO.
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Check a customer in — either against an existing booking, or as a walk-in.
// This is where a queue_ticket is actually born.
async function checkIn(req, res) {
  const { bookingId, customerId, serviceId } = req.body;
  const branchId = req.tenant.branchId || (req.body.branchId ? BigInt(req.body.branchId) : null);

  if (!branchId) {
    return res.status(400).json({ error: "branchId is required (or your account must be branch-scoped)" });
  }
  if (!customerId || !serviceId) {
    return res.status(400).json({ error: "customerId and serviceId are required" });
  }

  const queueDate = todayDateOnly();

  // Fetch the org's queue prefix (e.g. "R" for a restaurant) so the ticket
  // number is human-friendly, matching organization_settings from the schema.
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: req.tenant.organizationId },
  });
  const prefix = settings?.queuePrefix || "Q";

  // A transaction here matters: "count today's tickets for this branch" and
  // "insert the new ticket" must happen atomically, or two staff checking
  // customers in at the same exact moment could both compute the same next
  // number and create a duplicate ticket_number (which your unique
  // constraint would then reject anyway — the transaction just avoids the
  // wasted round-trip and gives a cleaner retry story).
  const ticket = await prisma.$transaction(async (tx) => {
    const countToday = await tx.queueTicket.count({
      where: {
        organizationId: req.tenant.organizationId,
        branchId,
        queueDate,
      },
    });

    const ticketNumber = `${prefix}${String(countToday + 1).padStart(3, "0")}`;

    const newTicket = await tx.queueTicket.create({
      data: {
        organizationId: req.tenant.organizationId,
        branchId,
        bookingId: bookingId ? BigInt(bookingId) : null,
        customerId: BigInt(customerId),
        serviceId: BigInt(serviceId),
        queueDate,
        ticketNumber,
        status: "waiting",
      },
    });

    await tx.queueHistory.create({
      data: {
        queueTicketId: newTicket.id,
        enteredQueueAt: new Date(),
      },
    });

    if (bookingId) {
      await tx.booking.update({
        where: { id: BigInt(bookingId) },
        data: { status: "checked_in" },
      });
    }

    return newTicket;
  });

  // Notification is fired outside the transaction on purpose: a slow/failed
  // SMS send should never roll back the queue ticket that was successfully
  // created. Queueing/logging notification failures separately (see
  // notifications table) is the right place for that concern — stubbed here.
  // await sendNotification(ticket.customerId, `Your queue number is ${ticket.ticketNumber}`);

  return res.status(201).json(serialize(ticket));
}

// Staff clicks "Call Next" at their counter.
async function callNext(req, res) {
  const { counterId } = req.body;
  if (!counterId) return res.status(400).json({ error: "counterId is required" });

  const branchId = req.tenant.branchId;
  if (!branchId) return res.status(400).json({ error: "Your account must be branch-scoped to call tickets" });

  // Priority tickets (VIP=2, priority=1) are pulled before normal (0)
  // tickets regardless of arrival order — this is the `priority` column
  // from the schema doing real work. Within the same priority level, oldest
  // `createdAt` wins (standard FIFO).
  const nextTicket = await prisma.queueTicket.findFirst({
    where: {
      organizationId: req.tenant.organizationId,
      branchId,
      status: "waiting",
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  if (!nextTicket) {
    return res.status(404).json({ error: "No customers waiting" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.queueTicket.update({
      where: { id: nextTicket.id },
      data: {
        status: "called",
        calledAt: new Date(),
        counterId: BigInt(counterId),
      },
    });

    await tx.queueHistory.update({
      where: { queueTicketId: nextTicket.id },
      data: { calledAt: new Date() },
    });

    return t;
  });

  return res.json(serialize(updated));
}

// Staff marks a ticket as actively being served (customer has reached the counter).
async function markServing(req, res) {
  const ticketId = BigInt(req.params.id);

  const ticket = await prisma.queueTicket.findFirst({
    where: { id: ticketId, organizationId: req.tenant.organizationId },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.queueTicket.update({
      where: { id: ticketId },
      data: { status: "serving" },
    });
    await tx.queueHistory.update({
      where: { queueTicketId: ticketId },
      data: { serviceStartAt: new Date() },
    });
    return t;
  });

  return res.json(serialize(updated));
}

// Staff marks a ticket complete — this is where wait_time_seconds and
// service_time_seconds (used for every report in Phase 7) actually get computed.
async function completeTicket(req, res) {
  const ticketId = BigInt(req.params.id);

  const ticket = await prisma.queueTicket.findFirst({
    where: { id: ticketId, organizationId: req.tenant.organizationId },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const history = await prisma.queueHistory.findUnique({ where: { queueTicketId: ticketId } });

  const now = new Date();
  const waitTimeSeconds = history?.calledAt
    ? Math.round((history.calledAt.getTime() - history.enteredQueueAt.getTime()) / 1000)
    : null;
  const serviceTimeSeconds = history?.serviceStartAt
    ? Math.round((now.getTime() - history.serviceStartAt.getTime()) / 1000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.queueTicket.update({
      where: { id: ticketId },
      data: { status: "completed" },
    });
    await tx.queueHistory.update({
      where: { queueTicketId: ticketId },
      data: { completedAt: now, waitTimeSeconds, serviceTimeSeconds },
    });
    return t;
  });

  return res.json(serialize(updated));
}

// The live queue board — what staff/customers watch update in real time.
// Polling (client re-fetches this every few seconds) is the right MVP
// choice; don't reach for WebSockets until this simple version feels slow.
async function liveBoard(req, res) {
  const branchId = req.query.branchId ? BigInt(req.query.branchId) : req.tenant.branchId;
  if (!branchId) return res.status(400).json({ error: "branchId is required" });

  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      branchId,
      status: { in: ["waiting", "called", "serving"] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { customer: { select: { name: true } }, service: { select: { name: true } } },
  });

  return res.json(tickets.map(serialize));
}

function serialize(ticket) {
  return {
    ...ticket,
    id: ticket.id.toString(),
    organizationId: ticket.organizationId.toString(),
    branchId: ticket.branchId.toString(),
    bookingId: ticket.bookingId ? ticket.bookingId.toString() : null,
    customerId: ticket.customerId ? ticket.customerId.toString() : undefined,
    serviceId: ticket.serviceId ? ticket.serviceId.toString() : undefined,
    counterId: ticket.counterId ? ticket.counterId.toString() : null,
  };
}

module.exports = { checkIn, callNext, markServing, completeTicket, liveBoard };
