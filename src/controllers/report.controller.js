const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
function parseDateRange(query) {
  const end = query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : new Date();
  const start = query.startDate ? new Date(`${query.startDate}T00:00:00.000Z`) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError(400, "startDate/endDate must be valid dates (YYYY-MM-DD)");
  }
  if (start > end) {
    throw httpError(400, "startDate must be before endDate");
  }
  return {
    start,
    end
  };
}
async function resolveBranchFilter(organizationId, branchIdRaw) {
  if (!branchIdRaw) return undefined;
  const branchId = BigInt(branchIdRaw);
  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId
    }
  });
  if (!branch) throw httpError(400, "branchId does not belong to this organization");
  return branchId;
}
function dayKey(date) {
  return date.toISOString().slice(0, 10);
}
const BOOKING_STATUSES = ["pending", "confirmed", "checked_in", "cancelled", "completed", "no_show"];
function emptyStatusCounts() {
  return BOOKING_STATUSES.reduce((acc, s) => ({
    ...acc,
    [s]: 0
  }), {});
}
async function getBookingReport(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? {
        branchId
      } : {}),
      ...(req.query.serviceId ? {
        serviceId: BigInt(req.query.serviceId)
      } : {}),
      bookingDate: {
        gte: start,
        lte: end
      },
      deletedAt: null
    },
    select: {
      bookingDate: true,
      status: true
    }
  });
  const byStatus = emptyStatusCounts();
  const byDayMap = new Map();
  for (const b of bookings) {
    byStatus[b.status] += 1;
    const key = dayKey(b.bookingDate);
    if (!byDayMap.has(key)) byDayMap.set(key, {
      date: key,
      total: 0,
      byStatus: emptyStatusCounts()
    });
    const dayEntry = byDayMap.get(key);
    dayEntry.total += 1;
    dayEntry.byStatus[b.status] += 1;
  }
  const byDay = Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    totalBookings: bookings.length,
    byStatus,
    byDay
  }));
}
async function getQueuePerformanceReport(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const tickets = await prisma.queueTicket.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? {
        branchId
      } : {}),
      queueDate: {
        gte: start,
        lte: end
      },
      history: {
        waitTimeSeconds: {
          not: null
        }
      }
    },
    select: {
      queueDate: true,
      history: {
        select: {
          waitTimeSeconds: true,
          serviceTimeSeconds: true
        }
      }
    }
  });
  const byDayMap = new Map();
  let totalWait = 0;
  let waitSamples = 0;
  let totalService = 0;
  let serviceSamples = 0;
  for (const t of tickets) {
    const key = dayKey(t.queueDate);
    if (!byDayMap.has(key)) {
      byDayMap.set(key, {
        date: key,
        ticketsServed: 0,
        waitSum: 0,
        waitCount: 0,
        serviceSum: 0,
        serviceCount: 0
      });
    }
    const day = byDayMap.get(key);
    day.ticketsServed += 1;
    if (t.history?.waitTimeSeconds != null) {
      day.waitSum += t.history.waitTimeSeconds;
      day.waitCount += 1;
      totalWait += t.history.waitTimeSeconds;
      waitSamples += 1;
    }
    if (t.history?.serviceTimeSeconds != null) {
      day.serviceSum += t.history.serviceTimeSeconds;
      day.serviceCount += 1;
      totalService += t.history.serviceTimeSeconds;
      serviceSamples += 1;
    }
  }
  const byDay = Array.from(byDayMap.values()).map(d => ({
    date: d.date,
    ticketsServed: d.ticketsServed,
    averageWaitTimeSeconds: d.waitCount ? Math.round(d.waitSum / d.waitCount) : null,
    averageServiceTimeSeconds: d.serviceCount ? Math.round(d.serviceSum / d.serviceCount) : null
  })).sort((a, b) => a.date.localeCompare(b.date));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    totalTicketsServed: tickets.length,
    averageWaitTimeSeconds: waitSamples ? Math.round(totalWait / waitSamples) : null,
    averageServiceTimeSeconds: serviceSamples ? Math.round(totalService / serviceSamples) : null,
    byDay
  }));
}
async function getNoShowReport(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const bookings = await prisma.booking.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      ...(branchId ? {
        branchId
      } : {}),
      bookingDate: {
        gte: start,
        lte: end
      },
      status: {
        in: ["completed", "no_show"]
      },
      deletedAt: null
    },
    select: {
      status: true,
      serviceId: true,
      service: {
        select: {
          name: true
        }
      }
    }
  });
  const completed = bookings.filter(b => b.status === "completed").length;
  const noShow = bookings.filter(b => b.status === "no_show").length;
  const byServiceMap = new Map();
  for (const b of bookings) {
    const key = b.serviceId.toString();
    if (!byServiceMap.has(key)) {
      byServiceMap.set(key, {
        serviceId: b.serviceId,
        serviceName: b.service.name,
        completed: 0,
        noShow: 0
      });
    }
    const entry = byServiceMap.get(key);
    if (b.status === "completed") entry.completed += 1;else entry.noShow += 1;
  }
  const byService = Array.from(byServiceMap.values()).map(s => ({
    ...s,
    noShowRatePercent: s.completed + s.noShow ? round1(s.noShow / (s.completed + s.noShow) * 100) : 0
  }));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    completed,
    noShow,
    noShowRatePercent: completed + noShow ? round1(noShow / (completed + noShow) * 100) : 0,
    byService
  }));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
async function getDashboardSummary(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const baseWhere = {
    organizationId: req.tenant.organizationId,
    ...(branchId ? {
      branchId
    } : {})
  };
  const [bookings, ticketsWithHistory, concludedBookings] = await Promise.all([prisma.booking.findMany({
    where: {
      ...baseWhere,
      bookingDate: {
        gte: start,
        lte: end
      },
      deletedAt: null
    },
    select: {
      status: true
    }
  }), prisma.queueTicket.findMany({
    where: {
      ...baseWhere,
      queueDate: {
        gte: start,
        lte: end
      },
      history: {
        waitTimeSeconds: {
          not: null
        }
      }
    },
    select: {
      history: {
        select: {
          waitTimeSeconds: true,
          serviceTimeSeconds: true
        }
      }
    }
  }), prisma.booking.findMany({
    where: {
      ...baseWhere,
      bookingDate: {
        gte: start,
        lte: end
      },
      status: {
        in: ["completed", "no_show"]
      },
      deletedAt: null
    },
    select: {
      status: true
    }
  })]);
  const byStatus = emptyStatusCounts();
  for (const b of bookings) byStatus[b.status] += 1;
  const waitTimes = ticketsWithHistory.map(t => t.history.waitTimeSeconds).filter(v => v != null);
  const serviceTimes = ticketsWithHistory.map(t => t.history.serviceTimeSeconds).filter(v => v != null);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length) : null;
  const completed = concludedBookings.filter(b => b.status === "completed").length;
  const noShow = concludedBookings.filter(b => b.status === "no_show").length;
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    bookings: {
      total: bookings.length,
      byStatus
    },
    queue: {
      ticketsServed: ticketsWithHistory.length,
      averageWaitTimeSeconds: avg(waitTimes),
      averageServiceTimeSeconds: avg(serviceTimes)
    },
    noShowRatePercent: completed + noShow ? round1(noShow / (completed + noShow) * 100) : 0
  }));
}
module.exports = {
  getBookingReport,
  getQueuePerformanceReport,
  getNoShowReport,
  getDashboardSummary
};