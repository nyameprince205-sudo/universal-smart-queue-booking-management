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

// ------------------------------------------------------------
// Module 7: Executive Dashboard — deliberately NOT date-range-based like
// everything above it. This is a "what's happening RIGHT NOW" view (live
// queues, who's currently serving, who's currently waiting), so it always
// looks at the current moment plus today's completed activity — a Super
// Admin or Org Admin opening this expects to see the current state of
// their business, not a report they have to pick dates for first.
// ------------------------------------------------------------

function todayRangeUTC() {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

// A branch is flagged as "overloaded" using two simple, documented
// thresholds — more than 5 people currently waiting, OR an average wait
// today past 30 minutes. Not a sophisticated model, but a real, legible
// rule an Org Admin can understand and act on, rather than an opaque
// score. Easy to tune later if these numbers turn out wrong in practice.
const OVERLOAD_WAITING_THRESHOLD = 5;
const OVERLOAD_WAIT_SECONDS_THRESHOLD = 1800; // 30 minutes

async function getExecutiveSummary(req, res) {
  const organizationId = req.tenant.organizationId;
  const { start, end } = todayRangeUTC();

  // Phase 18, Module 11: week/month boundaries for growth-rate comparisons.
  // Sunday-start week, matching JS's own getUTCDay() convention (0 = Sunday)
  // rather than inventing a different week-start rule elsewhere in the app.
  const now = new Date();
  const thisWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);

  const [
    branches,
    allActiveTickets,
    todaysTickets,
    todaysAllBookings,
    todaysCompletedBookings,
    thisWeekBookingCount,
    lastWeekBookingCount,
    thisMonthBookingCount,
    lastMonthBookingCount,
  ] = await Promise.all([
    prisma.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    // "Right now" — every ticket currently in the live queue, org-wide.
    prisma.queueTicket.findMany({
      where: { organizationId, status: { in: ["waiting", "called", "serving"] } },
      select: { branchId: true, status: true, handledByUserId: true },
    }),
    // Today's full activity — now also pulling the handler's NAME (Module
    // 11's "Best Staff" needs it) alongside everything the branch cards
    // already used this for.
    prisma.queueTicket.findMany({
      where: { organizationId, queueDate: { gte: start, lte: end } },
      select: {
        branchId: true,
        status: true,
        handledByUserId: true,
        handledByUser: { select: { name: true } },
        history: { select: { waitTimeSeconds: true, serviceTimeSeconds: true } },
      },
    }),
    // Module 10's "Bookings today" card field is EVERY booking today
    // (pending/confirmed/etc, not just completed) — a separate query from
    // todaysCompletedBookings below, which stays completed-only since
    // that's what revenue/service-ranking actually need.
    prisma.booking.findMany({
      where: { organizationId, bookingDate: { gte: start, lte: end }, deletedAt: null },
      select: { branchId: true },
    }),
    prisma.booking.findMany({
      where: { organizationId, bookingDate: { gte: start, lte: end }, status: "completed", deletedAt: null },
      select: { branchId: true, serviceId: true, service: { select: { name: true, price: true } } },
    }),
    prisma.booking.count({ where: { organizationId, bookingDate: { gte: thisWeekStart, lte: end }, deletedAt: null } }),
    prisma.booking.count({ where: { organizationId, bookingDate: { gte: lastWeekStart, lte: lastWeekEnd }, deletedAt: null } }),
    prisma.booking.count({ where: { organizationId, bookingDate: { gte: thisMonthStart, lte: end }, deletedAt: null } }),
    prisma.booking.count({ where: { organizationId, bookingDate: { gte: lastMonthStart, lte: lastMonthEnd }, deletedAt: null } }),
  ]);

  const activeCounters = await prisma.serviceCounter.count({ where: { organizationId, status: "open" } });

  const customersWaiting = allActiveTickets.filter((t) => t.status === "waiting").length;
  const customersServing = allActiveTickets.filter((t) => t.status === "serving").length;
  const customersCompletedToday = todaysTickets.filter((t) => t.status === "completed").length;
  const activeStaffIds = new Set(allActiveTickets.map((t) => t.handledByUserId).filter(Boolean).map((id) => id.toString()));

  const waitTimesToday = todaysTickets.map((t) => t.history?.waitTimeSeconds).filter((v) => v != null);
  const serviceTimesToday = todaysTickets.map((t) => t.history?.serviceTimeSeconds).filter((v) => v != null);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length) : null);

  // Branch ranking — reuses the SAME per-branch shape as Module 5's branch
  // comparison, but scoped to today only and sorted by tickets served, so
  // "ranking" actually means something (most active branch first).
  //
  // Module 10 additions: bookingsToday, staffAvailable, queueEfficiency —
  // everything the spec's branch CARD needs that the table-based branch
  // comparison (Module 5) never needed.
  const branchRanking = branches
    .map((branch) => {
      const branchActiveTickets = allActiveTickets.filter((t) => t.branchId === branch.id);
      const branchTodayTickets = todaysTickets.filter((t) => t.branchId === branch.id);
      const branchWaitTimes = branchTodayTickets.map((t) => t.history?.waitTimeSeconds).filter((v) => v != null);
      const waiting = branchActiveTickets.filter((t) => t.status === "waiting").length;
      const averageWaitTimeSeconds = branchWaitTimes.length
        ? Math.round(branchWaitTimes.reduce((a, v) => a + v, 0) / branchWaitTimes.length)
        : null;
      const branchCompleted = branchTodayTickets.filter((t) => t.status === "completed").length;
      const branchMissed = branchTodayTickets.filter((t) => t.status === "missed").length;
      const branchStaffIds = new Set(branchTodayTickets.map((t) => t.handledByUserId).filter(Boolean).map((id) => id.toString()));

      return {
        branchId: branch.id,
        branchName: branch.name,
        customersWaiting: waiting,
        ticketsServedToday: branchCompleted,
        bookingsToday: todaysAllBookings.filter((b) => b.branchId === branch.id).length,
        staffAvailable: branchStaffIds.size,
        queueEfficiencyPercent: branchCompleted + branchMissed > 0 ? round1((branchCompleted / (branchCompleted + branchMissed)) * 100) : null,
        averageWaitTimeSeconds,
        // See the constants above for what these thresholds mean and why.
        overloaded: waiting > OVERLOAD_WAITING_THRESHOLD || (averageWaitTimeSeconds || 0) > OVERLOAD_WAIT_SECONDS_THRESHOLD,
      };
    })
    .sort((a, b) => b.ticketsServedToday - a.ticketsServedToday);

  // Service ranking — today's completed bookings only, most-booked first.
  const serviceCounts = new Map();
  let todaysRevenue = 0;
  for (const b of todaysCompletedBookings) {
    const key = b.serviceId.toString();
    if (!serviceCounts.has(key)) serviceCounts.set(key, { serviceId: b.serviceId, serviceName: b.service.name, count: 0 });
    serviceCounts.get(key).count += 1;
    todaysRevenue += b.service.price ? parseFloat(b.service.price.toString()) : 0;
  }
  const serviceRanking = Array.from(serviceCounts.values()).sort((a, b) => b.count - a.count);

  const overloadedBranches = branchRanking.filter((b) => b.overloaded);

  // Module 11: Best Staff — grouped from the SAME todaysTickets data the
  // branch cards already computed from, just re-sliced by staff instead of
  // by branch. A staff member with zero completed tickets today never
  // appears here — "best" implies having actually completed something.
  const staffCompletedCounts = new Map();
  for (const t of todaysTickets) {
    if (t.status !== "completed" || !t.handledByUserId) continue;
    const key = t.handledByUserId.toString();
    if (!staffCompletedCounts.has(key)) {
      staffCompletedCounts.set(key, { userId: t.handledByUserId, name: t.handledByUser?.name || "Unknown", completed: 0 });
    }
    staffCompletedCounts.get(key).completed += 1;
  }
  const bestStaff = Array.from(staffCompletedCounts.values()).sort((a, b) => b.completed - a.completed)[0] || null;

  // Best/worst branch by wait time — only ever considers branches that
  // actually HAVE a wait-time average today; a branch with zero traffic
  // shouldn't win "lowest wait time" by default just because null sorts
  // oddly, so those are filtered out entirely first.
  const branchesWithWaitData = branchRanking.filter((b) => b.averageWaitTimeSeconds != null);
  const highestWaitBranch = branchesWithWaitData.length
    ? [...branchesWithWaitData].sort((a, b) => b.averageWaitTimeSeconds - a.averageWaitTimeSeconds)[0]
    : null;
  const lowestWaitBranch = branchesWithWaitData.length
    ? [...branchesWithWaitData].sort((a, b) => a.averageWaitTimeSeconds - b.averageWaitTimeSeconds)[0]
    : null;

  return res.json(
    toJSONSafe({
      generatedAt: new Date().toISOString(),
      live: {
        customersWaiting,
        customersServing,
        activeStaffCount: activeStaffIds.size,
        activeCounters,
      },
      today: {
        customersCompleted: customersCompletedToday,
        averageWaitTimeSeconds: avg(waitTimesToday),
        averageServiceTimeSeconds: avg(serviceTimesToday),
        revenue: round1(todaysRevenue),
      },
      branchRanking,
      serviceRanking,
      alerts: overloadedBranches.map((b) => ({
        branchId: b.branchId,
        branchName: b.branchName,
        reason:
          b.customersWaiting > OVERLOAD_WAITING_THRESHOLD
            ? `${b.customersWaiting} customers currently waiting`
            : `Average wait today is ${Math.round((b.averageWaitTimeSeconds || 0) / 60)} minutes`,
      })),
      // Phase 18, Module 11: everything below is new.
      summary: {
        weeklyGrowthPercent: computeGrowth(thisWeekBookingCount, lastWeekBookingCount),
        monthlyGrowthPercent: computeGrowth(thisMonthBookingCount, lastMonthBookingCount),
        bestBranch: branchRanking[0] ? { branchId: branchRanking[0].branchId, branchName: branchRanking[0].branchName, ticketsServedToday: branchRanking[0].ticketsServedToday } : null,
        bestStaff,
        mostRequestedService: serviceRanking[0] || null,
        highestWaitBranch: highestWaitBranch ? { branchId: highestWaitBranch.branchId, branchName: highestWaitBranch.branchName, averageWaitTimeSeconds: highestWaitBranch.averageWaitTimeSeconds } : null,
        lowestWaitBranch: lowestWaitBranch ? { branchId: lowestWaitBranch.branchId, branchName: lowestWaitBranch.branchName, averageWaitTimeSeconds: lowestWaitBranch.averageWaitTimeSeconds } : null,
      },
    })
  );
}

// Same null-when-baseline-is-zero reasoning as computeTrend() used
// elsewhere in this file — a "growth rate" from a zero baseline isn't a
// real percentage worth displaying.
function computeGrowth(current, previous) {
  if (!previous) return null;
  return round1(((current - previous) / previous) * 100);
}

// ------------------------------------------------------------
// Phase 18, Module 1/2/3: Dashboard homepage — 14 KPI cards with
// trend-vs-yesterday, plus 7-day chart data for Module 2's charts, all in
// ONE call (Module 13 explicitly asks to "reduce unnecessary API
// requests" — building that in from the start here rather than retrofitting
// it later).
// ------------------------------------------------------------

function dayBounds(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

// Null (not 0, not Infinity) when yesterday's value was 0 or missing —
// "up 400%" from a base of zero is a real number but a misleading thing to
// show on a KPI card; the frontend shows "—" instead of a trend in that case.
function computeTrend(todayValue, yesterdayValue) {
  if (yesterdayValue == null || yesterdayValue === 0) return null;
  return round1(((todayValue - yesterdayValue) / yesterdayValue) * 100);
}

// Shared by both "today" and "yesterday" below — same full-day totals
// either way, just a different date range. Deliberately does NOT include
// customersWaiting/customersServing (see the big comment on
// getHomeDashboard for why those two are handled separately as pure
// "right now" numbers with no day-bounded equivalent).
async function computeDayStats(organizationId, dayStart, dayEnd) {
  const [bookings, tickets] = await Promise.all([
    prisma.booking.findMany({
      where: { organizationId, bookingDate: { gte: dayStart, lte: dayEnd }, deletedAt: null },
      select: { status: true },
    }),
    prisma.queueTicket.findMany({
      where: { organizationId, queueDate: { gte: dayStart, lte: dayEnd } },
      select: {
        status: true,
        handledByUserId: true,
        history: { select: { waitTimeSeconds: true, serviceTimeSeconds: true } },
      },
    }),
  ]);

  const waitTimes = tickets.map((t) => t.history?.waitTimeSeconds).filter((v) => v != null);
  const serviceTimes = tickets.map((t) => t.history?.serviceTimeSeconds).filter((v) => v != null);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length) : null);

  const customersServed = tickets.filter((t) => t.status === "completed").length;
  const missedCustomers = tickets.filter((t) => t.status === "missed").length;
  const activeStaffIds = new Set(tickets.map((t) => t.handledByUserId).filter(Boolean).map((id) => id.toString()));

  return {
    bookings: bookings.length,
    queueTickets: tickets.length,
    customersServed,
    averageWaitTimeSeconds: avg(waitTimes),
    averageServiceTimeSeconds: avg(serviceTimes),
    activeStaff: activeStaffIds.size,
    completedAppointments: bookings.filter((b) => b.status === "completed").length,
    cancelledAppointments: bookings.filter((b) => b.status === "cancelled").length,
    missedCustomers,
    queueEfficiencyPercent:
      customersServed + missedCustomers > 0 ? round1((customersServed / (customersServed + missedCustomers)) * 100) : null,
  };
}

async function getHomeDashboard(req, res) {
  const organizationId = req.tenant.organizationId;
  const todayRange = dayBounds(0);
  const yesterdayRange = dayBounds(1);

  const [todayStats, yesterdayStats, liveTickets, activeCounters, activeBranches, weekTickets, weekBookings] = await Promise.all([
    computeDayStats(organizationId, todayRange.start, todayRange.end),
    computeDayStats(organizationId, yesterdayRange.start, yesterdayRange.end),
    // "Right now" — see the note on computeDayStats above for why these
    // two live numbers are kept OUT of the day-bounded stats entirely.
    prisma.queueTicket.findMany({
      where: { organizationId, status: { in: ["waiting", "serving"] } },
      select: { status: true },
    }),
    prisma.serviceCounter.count({ where: { organizationId, status: "open" } }),
    prisma.branch.count({ where: { organizationId, status: "active" } }),
    // Module 2's charts: last 7 days of raw activity, fetched once here
    // rather than making the frontend hit two more report endpoints.
    prisma.queueTicket.findMany({
      where: { organizationId, queueDate: { gte: dayBounds(6).start, lte: todayRange.end } },
      select: { queueDate: true },
    }),
    prisma.booking.findMany({
      where: { organizationId, bookingDate: { gte: dayBounds(6).start, lte: todayRange.end }, deletedAt: null },
      select: { bookingDate: true },
    }),
  ]);

  function trendCard(key, goodDirection = "up") {
    return {
      value: todayStats[key],
      trendPercent: computeTrend(todayStats[key], yesterdayStats[key]),
      goodDirection, // "up" or "down" — whether an increase is good news for THIS metric (e.g. bookings up = good, wait time up = bad)
    };
  }

  function dayKeyRange(daysBack) {
    const keys = [];
    for (let i = daysBack; i >= 0; i--) keys.push(dayKey(dayBounds(i).start));
    return keys;
  }
  const last7Days = dayKeyRange(6);
  const queueActivityByDay = Object.fromEntries(last7Days.map((d) => [d, 0]));
  for (const t of weekTickets) queueActivityByDay[dayKey(t.queueDate)] = (queueActivityByDay[dayKey(t.queueDate)] || 0) + 1;
  const bookingsByDay = Object.fromEntries(last7Days.map((d) => [d, 0]));
  for (const b of weekBookings) bookingsByDay[dayKey(b.bookingDate)] = (bookingsByDay[dayKey(b.bookingDate)] || 0) + 1;

  return res.json(
    toJSONSafe({
      generatedAt: new Date().toISOString(),
      live: {
        customersWaiting: liveTickets.filter((t) => t.status === "waiting").length,
        customersServing: liveTickets.filter((t) => t.status === "serving").length,
        activeCounters,
        activeBranches,
      },
      today: {
        bookings: trendCard("bookings"),
        queueTickets: trendCard("queueTickets"),
        customersServed: trendCard("customersServed"),
        averageWaitTimeSeconds: trendCard("averageWaitTimeSeconds", "down"),
        averageServiceTimeSeconds: trendCard("averageServiceTimeSeconds", "down"),
        activeStaff: trendCard("activeStaff"),
        completedAppointments: trendCard("completedAppointments"),
        cancelledAppointments: trendCard("cancelledAppointments", "down"),
        missedCustomers: trendCard("missedCustomers", "down"),
        queueEfficiencyPercent: trendCard("queueEfficiencyPercent"),
      },
      queueActivityTrend: last7Days.map((date) => ({ date, count: queueActivityByDay[date] })),
      bookingsTrend: last7Days.map((date) => ({ date, count: bookingsByDay[date] })),
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
  getExecutiveSummary,
  getHomeDashboard,
};
