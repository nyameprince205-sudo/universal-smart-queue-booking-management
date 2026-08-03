const prisma = require("../config/db");
const { randomUUID } = require("crypto");
const { emitQueueUpdate } = require("../socket");
const { notifyInBackground, getPreferredChannel } = require("../services/notification.service");

// This file is the heart of the whole product. Read the comments closely —
// this is the part worth understanding deeply, not just copying.

// Service counters (Teller 1, Reception Desk, Consultation Room 1...) need
// to exist before callNext can assign a ticket to one. Nothing built so far
// creates them through the API — only seed.sql did, by hand. That's a real
// gap, not a test convenience, so it's fixed here rather than worked around.
async function createCounter(req, res) {
  const { branchId, name } = req.body;
  if (!branchId || !name) return res.status(400).json({ error: "branchId and name are required" });

  const branch = await prisma.branch.findFirst({
    where: { id: BigInt(branchId), organizationId: req.tenant.organizationId },
  });
  if (!branch) return res.status(400).json({ error: "branchId does not belong to this organization" });

  const counter = await prisma.serviceCounter.create({
    data: { organizationId: req.tenant.organizationId, branchId: BigInt(branchId), name },
  });

  return res.status(201).json({
    id: counter.id.toString(),
    organizationId: counter.organizationId.toString(),
    branchId: counter.branchId.toString(),
    name: counter.name,
    status: counter.status,
  });
}

// Same gap as the comment above about createCounter: nothing lets a caller
// find out WHICH counters already exist for a branch. Phase 15's Staff
// Queue Console needs exactly this (to show a "which counter are you at"
// dropdown before calling the next customer), so it's added now rather
// than worked around in the frontend with a hardcoded/typed-in counter id.
async function listCounters(req, res) {
  const branchId = req.query.branchId ? BigInt(req.query.branchId) : req.tenant.branchId;
  if (!branchId) return res.status(400).json({ error: "branchId is required" });

  const counters = await prisma.serviceCounter.findMany({
    where: { organizationId: req.tenant.organizationId, branchId },
    orderBy: { name: "asc" },
  });

  return res.json(
    counters.map((c) => ({
      id: c.id.toString(),
      organizationId: c.organizationId.toString(),
      branchId: c.branchId.toString(),
      name: c.name,
      status: c.status,
    }))
  );
}

function todayDateOnly() {
  // MySQL DATE columns don't care about time-of-day, so we normalize to
  // midnight UTC here. In production you'd use the organization's configured
  // timezone (organization_settings.timezone) instead of the server's — left
  // as a deliberate simplification for now; note it as a known TODO.
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Shared by the HTTP liveBoard route AND every mutation below. Extracting
// this means "what does the board look like right now" is defined in
// exactly one place — the REST response and the Socket.IO broadcast can
// never quietly drift out of sync with each other.
async function fetchBoard(organizationId, branchId) {
  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId,
      branchId,
      status: { in: ["waiting", "called", "serving"] },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    include: { customer: { select: { name: true } }, service: { select: { name: true } } },
  });
  return tickets.map(serialize);
}

// The single place every mutation below calls after changing ticket state.
// Broadcasting AFTER the database write (not inside the transaction) is
// deliberate — Socket.IO has no concept of a rollback, so if we emitted
// before the transaction committed and it then failed, connected clients
// would have seen a queue update that never actually happened in the DB.
async function broadcastBoard(organizationId, branchId) {
  const board = await fetchBoard(organizationId, branchId);
  emitQueueUpdate(branchId.toString(), board);
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
        uuid: randomUUID(),
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

  // Fired AFTER the transaction commits — same reasoning as
  // booking.controller.js: a slow/failed send should never roll back a
  // queue ticket that was already successfully created.
  const channel = await getPreferredChannel(req.tenant.organizationId);
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "customer",
    recipientId: BigInt(customerId),
    channel,
    message: `Your queue number is ${ticket.ticketNumber}. Please wait to be called.`,
  });

  await broadcastBoard(req.tenant.organizationId, branchId);

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

    // upsert, not update: a queue_history row SHOULD always exist (checkIn
    // creates it atomically alongside the ticket), but real production data
    // can have edge cases that predate your code — e.g. a row inserted by
    // hand, or a future data-migration gap. update() would throw "record
    // not found" and abort the whole transaction over a single missing
    // history row; upsert() heals it instead, using the ticket's own
    // createdAt as a reasonable enteredQueueAt if history never existed.
    await tx.queueHistory.upsert({
      where: { queueTicketId: nextTicket.id },
      update: { calledAt: new Date() },
      create: { queueTicketId: nextTicket.id, enteredQueueAt: nextTicket.createdAt, calledAt: new Date() },
    });

    return t;
  });

  const channel = await getPreferredChannel(req.tenant.organizationId);
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "customer",
    recipientId: nextTicket.customerId,
    channel,
    message: `You're being called! Please proceed to the counter — ticket ${nextTicket.ticketNumber}.`,
  });

  await broadcastBoard(req.tenant.organizationId, branchId);

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
    await tx.queueHistory.upsert({
      where: { queueTicketId: ticketId },
      update: { serviceStartAt: new Date() },
      create: { queueTicketId: ticketId, enteredQueueAt: ticket.createdAt, serviceStartAt: new Date() },
    });
    return t;
  });

  await broadcastBoard(req.tenant.organizationId, ticket.branchId);

  return res.json(serialize(updated));
}

// Staff marks a ticket complete — this is where wait_time_seconds and
// service_time_seconds (used for every report in Phase 14) actually get computed.
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
    await tx.queueHistory.upsert({
      where: { queueTicketId: ticketId },
      update: { completedAt: now, waitTimeSeconds, serviceTimeSeconds },
      create: {
        queueTicketId: ticketId,
        enteredQueueAt: ticket.createdAt,
        completedAt: now,
        waitTimeSeconds,
        serviceTimeSeconds,
      },
    });
    return t;
  });

  await broadcastBoard(req.tenant.organizationId, ticket.branchId);

  return res.json(serialize(updated));
}

// The live queue board over plain HTTP — used for the initial page load
// (a client fetches this once to populate its starting state), then relies
// on the "queue:update" Socket.IO event for everything after that. Keeping
// this endpoint around even with Socket.IO wired in matters: a client that
// hasn't connected its socket yet (or reconnects after a drop) still needs
// a way to get the CURRENT state, not just future updates.
async function liveBoard(req, res) {
  const branchId = req.query.branchId ? BigInt(req.query.branchId) : req.tenant.branchId;
  if (!branchId) return res.status(400).json({ error: "branchId is required" });

  const board = await fetchBoard(req.tenant.organizationId, branchId);
  return res.json(board);
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

module.exports = { checkIn, callNext, markServing, completeTicket, liveBoard, createCounter, listCounters };
