const prisma = require("../config/db");
const { toJSONSafe } = require("../utils/serialize");

// ------------------------------------------------------------
// Shared helpers — deliberately DUPLICATED from report.controller.js
// rather than imported from it. report.controller.js doesn't currently
// export these (only its 4 route handlers), and reshaping a file that
// already works and is fully tested — just to share ~15 lines of pure,
// simple logic — carries more risk than the duplication does. If this
// class of helper needs to change later, it needs to change in both
// places; that's a small, known cost worth taking here.
// ------------------------------------------------------------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseDateRange(query) {
  const end = query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : new Date();
  const start = query.startDate
    ? new Date(`${query.startDate}T00:00:00.000Z`)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError(400, "startDate/endDate must be valid dates (YYYY-MM-DD)");
  }
  if (start > end) {
    throw httpError(400, "startDate must be before endDate");
  }

  return { start, end };
}

async function resolveBranchFilter(organizationId, branchIdRaw) {
  if (!branchIdRaw) return undefined;
  const branchId = BigInt(branchIdRaw);
  const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId } });
  if (!branch) throw httpError(400, "branchId does not belong to this organization");
  return branchId;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------
// Module 4a: Service popularity — most/least requested
// ------------------------------------------------------------

// Returns every service that had at least one booking in range, sorted
// most-to-least popular. Deliberately NOT pre-split into "top 5"/"bottom
// 5" server-side — the frontend can slice whatever N it wants to display
// without needing a new query param and a second round-trip for a
// different N later.
async function getServicePopularity(req, res) {
  const { start, end } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? { branchId } : {}),
      bookingDate: { gte: start, lte: end },
      deletedAt: null,
    },
    select: { serviceId: true, service: { select: { name: true } } },
  });

  const counts = new Map();
  for (const b of bookings) {
    const key = b.serviceId.toString();
    if (!counts.has(key)) {
      counts.set(key, { serviceId: b.serviceId, serviceName: b.service.name, bookingCount: 0 });
    }
    counts.get(key).bookingCount += 1;
  }

  const services = Array.from(counts.values()).sort((a, b) => b.bookingCount - a.bookingCount);

  return res.json(toJSONSafe({ range: { startDate: dayKey(start), endDate: dayKey(end) }, services }));
}

// ------------------------------------------------------------
// Module 4b: Peak hours
// ------------------------------------------------------------

// Uses queue_ticket.createdAt (when a customer actually entered the
// queue) rather than a booking's scheduled bookingTime — that reflects
// real foot traffic, not just what time slots people picked when
// booking ahead. Same UTC-hour simplification noted elsewhere in this
// codebase (see queue.controller.js's todayDateOnly) rather than using
// the organization's configured timezone.
async function getPeakHours(req, res) {
  const { start, end } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);

  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? { branchId } : {}),
      queueDate: { gte: start, lte: end },
    },
    select: { createdAt: true },
  });

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ticketCount: 0 }));
  for (const t of tickets) {
    byHour[t.createdAt.getUTCHours()].ticketCount += 1;
  }

  return res.json(toJSONSafe({ range: { startDate: dayKey(start), endDate: dayKey(end) }, byHour }));
}

// ------------------------------------------------------------
// Module 4c: Booking trends at day/week/month/year granularity
// ------------------------------------------------------------

// Week grouping uses "the Monday of that week" as the bucket key, not a
// formal ISO week NUMBER — simpler to compute and verify correctly, and
// just as usable for a trend chart, which only needs consistent,
// chronologically-sortable buckets, not calendar-standard week numbering.
function periodKey(date, granularity) {
  if (granularity === "year") return String(date.getUTCFullYear());
  if (granularity === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (dayOfWeek + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diffToMonday);
    return dayKey(d);
  }
  return dayKey(date);
}

async function getBookingTrends(req, res) {
  const { start, end } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const granularity = ["week", "month", "year"].includes(req.query.granularity) ? req.query.granularity : "day";

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? { branchId } : {}),
      bookingDate: { gte: start, lte: end },
      deletedAt: null,
    },
    select: { bookingDate: true },
  });

  const counts = new Map();
  for (const b of bookings) {
    const key = periodKey(b.bookingDate, granularity);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const trend = Array.from(counts.entries())
    .map(([period, count]) => ({ period, count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return res.json(toJSONSafe({ range: { startDate: dayKey(start), endDate: dayKey(end) }, granularity, trend }));
}

// ------------------------------------------------------------
// Module 4d: Staff performance
// ------------------------------------------------------------

// Depends entirely on queue_tickets.handled_by_user_id (see the migration
// this shipped with, and queue.controller.js's callNext) — a ticket
// called BEFORE that migration/code change has no value here and is
// correctly excluded, not counted as some default staff member's work.
async function getStaffPerformance(req, res) {
  const { start, end } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);

  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? { branchId } : {}),
      queueDate: { gte: start, lte: end },
      handledByUserId: { not: null },
    },
    select: {
      handledByUserId: true,
      status: true,
      handledByUser: { select: { name: true } },
      history: { select: { serviceTimeSeconds: true } },
    },
  });

  const byStaff = new Map();
  for (const t of tickets) {
    const key = t.handledByUserId.toString();
    if (!byStaff.has(key)) {
      byStaff.set(key, {
        userId: t.handledByUserId,
        name: t.handledByUser.name,
        ticketsHandled: 0,
        completed: 0,
        missed: 0,
        serviceTimeSum: 0,
        serviceTimeCount: 0,
      });
    }
    const entry = byStaff.get(key);
    entry.ticketsHandled += 1;
    if (t.status === "completed") entry.completed += 1;
    if (t.status === "missed") entry.missed += 1;
    if (t.history?.serviceTimeSeconds != null) {
      entry.serviceTimeSum += t.history.serviceTimeSeconds;
      entry.serviceTimeCount += 1;
    }
  }

  const staff = Array.from(byStaff.values())
    .map((s) => ({
      userId: s.userId,
      name: s.name,
      ticketsHandled: s.ticketsHandled,
      completed: s.completed,
      missed: s.missed,
      averageServiceTimeSeconds: s.serviceTimeCount ? Math.round(s.serviceTimeSum / s.serviceTimeCount) : null,
    }))
    .sort((a, b) => b.ticketsHandled - a.ticketsHandled);

  return res.json(toJSONSafe({ range: { startDate: dayKey(start), endDate: dayKey(end) }, staff }));
}

// ------------------------------------------------------------
// Module 5: Branch comparison
// ------------------------------------------------------------

// No branchId filter accepted here on purpose — the entire point of this
// endpoint is showing EVERY branch side by side; filtering to one branch
// would just be the existing Phase 14 dashboard endpoint with extra steps.
async function getBranchComparison(req, res) {
  const { start, end } = parseDateRange(req.query);

  const branches = await prisma.branch.findMany({
    where: { organizationId: req.tenant.organizationId },
    select: { id: true, name: true },
  });

  const results = await Promise.all(
    branches.map(async (branch) => {
      const [totalBookings, ticketsWithHistory, concluded] = await Promise.all([
        prisma.booking.count({
          where: {
            organizationId: req.tenant.organizationId,
            branchId: branch.id,
            bookingDate: { gte: start, lte: end },
            deletedAt: null,
          },
        }),
        prisma.queueTicket.findMany({
          where: {
            organizationId: req.tenant.organizationId,
            branchId: branch.id,
            queueDate: { gte: start, lte: end },
            history: { waitTimeSeconds: { not: null } },
          },
          select: { history: { select: { waitTimeSeconds: true } } },
        }),
        prisma.booking.findMany({
          where: {
            organizationId: req.tenant.organizationId,
            branchId: branch.id,
            bookingDate: { gte: start, lte: end },
            status: { in: ["completed", "no_show"] },
            deletedAt: null,
          },
          select: { status: true },
        }),
      ]);

      const waitTimes = ticketsWithHistory.map((t) => t.history.waitTimeSeconds).filter((v) => v != null);
      const averageWaitTimeSeconds = waitTimes.length
        ? Math.round(waitTimes.reduce((a, v) => a + v, 0) / waitTimes.length)
        : null;
      const completed = concluded.filter((b) => b.status === "completed").length;
      const noShow = concluded.filter((b) => b.status === "no_show").length;

      return {
        branchId: branch.id,
        branchName: branch.name,
        totalBookings,
        ticketsServed: ticketsWithHistory.length,
        averageWaitTimeSeconds,
        noShowRatePercent: completed + noShow ? round1((noShow / (completed + noShow)) * 100) : 0,
      };
    })
  );

  return res.json(toJSONSafe({ range: { startDate: dayKey(start), endDate: dayKey(end) }, branches: results }));
}

// ------------------------------------------------------------
// Module 6: Revenue
// ------------------------------------------------------------

// Definition (confirmed explicitly, since there's no separate
// payment-per-booking system in this schema): revenue = the sum of
// service.price for every COMPLETED booking in range. This is DERIVED
// from bookings, not a recorded payment — a real business number, but
// worth being clear it isn't reconciled against any actual transaction
// record the way Subscription/Payment (Phase 13) is for platform billing.
async function getRevenueReport(req, res) {
  const { start, end } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);

  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? { branchId } : {}),
      bookingDate: { gte: start, lte: end },
      status: "completed",
      deletedAt: null,
    },
    select: {
      bookingDate: true,
      serviceId: true,
      service: { select: { name: true, price: true } },
    },
  });

  let totalRevenue = 0;
  const byServiceMap = new Map();
  const byDayMap = new Map();

  for (const b of bookings) {
    // parseFloat(...toString()) rather than Number(b.service.price)
    // directly — Prisma's Decimal type doesn't always coerce cleanly with
    // a bare Number() call depending on how it's represented at runtime;
    // going through its string form first is the safe, well-defined path
    // regardless of whether it's already a string, a number, or a
    // Decimal-like object.
    const price = b.service.price ? parseFloat(b.service.price.toString()) : 0;
    totalRevenue += price;

    const serviceKey = b.serviceId.toString();
    if (!byServiceMap.has(serviceKey)) {
      byServiceMap.set(serviceKey, { serviceId: b.serviceId, serviceName: b.service.name, revenue: 0, completedBookings: 0 });
    }
    const serviceEntry = byServiceMap.get(serviceKey);
    serviceEntry.revenue += price;
    serviceEntry.completedBookings += 1;

    const dayK = dayKey(b.bookingDate);
    byDayMap.set(dayK, (byDayMap.get(dayK) || 0) + price);
  }

  const byService = Array.from(byServiceMap.values())
    .map((s) => ({ ...s, revenue: round1(s.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
  const byDay = Array.from(byDayMap.entries())
    .map(([date, revenue]) => ({ date, revenue: round1(revenue) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return res.json(
    toJSONSafe({
      range: { startDate: dayKey(start), endDate: dayKey(end) },
      totalRevenue: round1(totalRevenue),
      currency: "GHS",
      byService,
      byDay,
    })
  );
}

module.exports = {
  getServicePopularity,
  getPeakHours,
  getBookingTrends,
  getStaffPerformance,
  getBranchComparison,
  getRevenueReport,
};
