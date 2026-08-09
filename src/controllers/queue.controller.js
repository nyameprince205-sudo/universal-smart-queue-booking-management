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
  //
  // Module 1 addition: the message now includes a tracking link, keyed by
  // the ticket's own uuid — this is the ONLY way a customer (especially a
  // guest with no account at all) gets to their live tracking page. See
  // trackTicket() below for the public endpoint this points at, and its
  // comment for why the uuid itself is the security boundary here.
  const channel = await getPreferredChannel(req.tenant.organizationId);
  const trackingLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/track/${ticket.uuid}`;
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "customer",
    recipientId: BigInt(customerId),
    channel,
    message: `Your queue number is ${ticket.ticketNumber}. Track your position live: ${trackingLink}`,
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

// ---- Module 1 addition: staff marks a CALLED ticket as missed — they
// called the customer's number but nobody came to the counter. This is
// deliberately distinct from `cancelled` (the customer proactively backed
// out) and from a booking's `no_show` (a different resource entirely,
// about an appointment, not a live queue position) — "missed" means
// specifically that the queue moved on without them after being called. ----
async function markMissed(req, res) {
  const ticketId = BigInt(req.params.id);

  const ticket = await prisma.queueTicket.findFirst({
    where: { id: ticketId, organizationId: req.tenant.organizationId },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (ticket.status !== "called") {
    return res
      .status(400)
      .json({ error: `Only a called ticket can be marked missed (this one is currently ${ticket.status})` });
  }

  const history = await prisma.queueHistory.findUnique({ where: { queueTicketId: ticketId } });
  // Still worth recording how long they DID wait before being missed —
  // that's real data about queue performance even though they never got served.
  const waitTimeSeconds = history?.calledAt
    ? Math.round((history.calledAt.getTime() - history.enteredQueueAt.getTime()) / 1000)
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.queueTicket.update({ where: { id: ticketId }, data: { status: "missed" } });
    await tx.queueHistory.upsert({
      where: { queueTicketId: ticketId },
      update: { completedAt: new Date(), waitTimeSeconds },
      create: {
        queueTicketId: ticketId,
        enteredQueueAt: ticket.createdAt,
        completedAt: new Date(),
        waitTimeSeconds,
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

// ---- Module 2: Smart Wait Time Estimation ----
// Computes today's (or the best available) average service duration for a
// branch. Tries today's completed tickets FIRST — that's the most
// relevant number, since it reflects how fast the branch is actually
// moving right now (fewer staff today, a slow morning, whatever it is).
// Falls back to the last 7 days if today has no completed tickets yet
// (e.g. this is the first customer of the day), then to a flat 10-minute
// default if there's no history at all (a brand new branch's very first
// ticket ever has nothing to average from).
async function averageServiceTimeSeconds(organizationId, branchId) {
  const todayStart = todayDateOnly();

  const todayAvg = await prisma.queueHistory.aggregate({
    _avg: { serviceTimeSeconds: true },
    where: {
      serviceTimeSeconds: { not: null },
      queueTicket: { organizationId, branchId, queueDate: todayStart },
    },
  });
  if (todayAvg._avg.serviceTimeSeconds != null) return Math.round(todayAvg._avg.serviceTimeSeconds);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekAvg = await prisma.queueHistory.aggregate({
    _avg: { serviceTimeSeconds: true },
    where: {
      serviceTimeSeconds: { not: null },
      queueTicket: { organizationId, branchId, queueDate: { gte: weekAgo } },
    },
  });
  if (weekAvg._avg.serviceTimeSeconds != null) return Math.round(weekAvg._avg.serviceTimeSeconds);

  return 600; // 10 minutes — last-resort default with zero historical data anywhere
}

// Computes a live estimate for ONE specific ticket. Only ever called by
// trackTicket() below — never by fetchBoard/broadcastBoard, since the
// staff board shows every active ticket on the branch at once, and
// computing a full per-ticket estimate for all of them on every single
// broadcast would be real work nobody on the staff side is even looking
// at. The customer tracking page asks for its own estimate directly
// instead, computed fresh each time.
async function computeEstimate(organizationId, branchId, ticket) {
  // Terminal states have nothing left to estimate.
  if (["completed", "cancelled", "missed"].includes(ticket.status)) {
    return { customersAhead: null, estimatedWaitSeconds: null, estimatedArrivalTime: null };
  }

  // Already called or being served — there's no meaningful "wait" left;
  // it's their turn now, not some number of minutes from now.
  if (ticket.status === "called" || ticket.status === "serving") {
    return { customersAhead: 0, estimatedWaitSeconds: 0, estimatedArrivalTime: new Date().toISOString() };
  }

  // status === "waiting" from here on. "Ahead of them" uses the EXACT same
  // priority-then-FIFO ordering as callNext's own query above — this
  // estimate would be actively misleading if it used a different order
  // than the one that actually decides who gets called next.
  const [customersAhead, activeCounters, avgServiceTimeSeconds] = await Promise.all([
    prisma.queueTicket.count({
      where: {
        organizationId,
        branchId,
        status: "waiting",
        OR: [
          { priority: { gt: ticket.priority } },
          { priority: ticket.priority, createdAt: { lt: ticket.createdAt } },
        ],
      },
    }),
    prisma.serviceCounter.count({ where: { organizationId, branchId, status: "open" } }),
    averageServiceTimeSeconds(organizationId, branchId),
  ]);

  // Never divide by zero, even if literally no counter is marked "open"
  // right now — the estimate degrades to "assume one counter" rather than
  // crashing or returning Infinity.
  const counters = Math.max(activeCounters, 1);
  // How many "rounds" of parallel service need to finish, across every
  // open counter, before this ticket's turn comes up. +1 accounts for
  // this ticket's own turn, not just the people strictly ahead of it.
  const roundsAhead = Math.ceil((customersAhead + 1) / counters);
  const estimatedWaitSeconds = roundsAhead * avgServiceTimeSeconds;

  return {
    customersAhead,
    estimatedWaitSeconds,
    estimatedArrivalTime: new Date(Date.now() + estimatedWaitSeconds * 1000).toISOString(),
  };
}

// ---- Module 1: customer-facing live tracking — PUBLIC, no auth at all.
// The ticket's uuid IS the access control here (122 bits of randomness,
// sent only to the customer who owns this ticket, via their own
// SMS/WhatsApp/email at check-in — see the trackingLink built inside
// checkIn() above). This is the exact same trust model the rest of this
// app already uses for booking/customer uuids; it's just the first time
// one is used as a lookup key for a fully unauthenticated GET. ----
async function trackTicket(req, res) {
  const ticket = await prisma.queueTicket.findUnique({
    where: { uuid: req.params.uuid },
    include: {
      customer: { select: { name: true } },
      service: { select: { name: true } },
      branch: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });

  if (!ticket) return res.status(404).json({ error: "Tracking link not found or expired" });

  const estimate = await computeEstimate(ticket.organizationId, ticket.branchId, ticket);

  // "Now serving" ticket number gives context even to someone far back in
  // line — watching the number tick forward is reassuring in a way a
  // static countdown by itself isn't.
  const nowServing = await prisma.queueTicket.findFirst({
    where: { organizationId: ticket.organizationId, branchId: ticket.branchId, status: "serving" },
    orderBy: { updatedAt: "desc" },
    select: { ticketNumber: true },
  });

  const customersCompletedToday = await prisma.queueTicket.count({
    where: {
      organizationId: ticket.organizationId,
      branchId: ticket.branchId,
      queueDate: ticket.queueDate,
      status: "completed",
    },
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
    ...estimate,
  });
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

module.exports = {
  checkIn,
  callNext,
  markServing,
  completeTicket,
  markMissed,
  liveBoard,
  trackTicket,
  createCounter,
  listCounters,
};
