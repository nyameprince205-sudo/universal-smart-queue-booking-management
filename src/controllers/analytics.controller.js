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
function round1(n) {
  return Math.round(n * 10) / 10;
}
async function getServicePopularity(req, res) {
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
      deletedAt: null
    },
    select: {
      serviceId: true,
      service: {
        select: {
          name: true
        }
      }
    }
  });
  const counts = new Map();
  for (const b of bookings) {
    const key = b.serviceId.toString();
    if (!counts.has(key)) {
      counts.set(key, {
        serviceId: b.serviceId,
        serviceName: b.service.name,
        bookingCount: 0
      });
    }
    counts.get(key).bookingCount += 1;
  }
  const services = Array.from(counts.values()).sort((a, b) => b.bookingCount - a.bookingCount);
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    services
  }));
}
async function getPeakHours(req, res) {
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
      }
    },
    select: {
      createdAt: true
    }
  });
  const byHour = Array.from({
    length: 24
  }, (_, hour) => ({
    hour,
    ticketCount: 0
  }));
  for (const t of tickets) {
    byHour[t.createdAt.getUTCHours()].ticketCount += 1;
  }
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    byHour
  }));
}
function periodKey(date, granularity) {
  if (granularity === "year") return String(date.getUTCFullYear());
  if (granularity === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = d.getUTCDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    d.setUTCDate(d.getUTCDate() - diffToMonday);
    return dayKey(d);
  }
  return dayKey(date);
}
async function getBookingTrends(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branchId = await resolveBranchFilter(req.tenant.organizationId, req.query.branchId);
  const granularity = ["week", "month", "year"].includes(req.query.granularity) ? req.query.granularity : "day";
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
      deletedAt: null
    },
    select: {
      bookingDate: true
    }
  });
  const counts = new Map();
  for (const b of bookings) {
    const key = periodKey(b.bookingDate, granularity);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const trend = Array.from(counts.entries()).map(([period, count]) => ({
    period,
    count
  })).sort((a, b) => a.period.localeCompare(b.period));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    granularity,
    trend
  }));
}
async function getStaffPerformance(req, res) {
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
      handledByUserId: {
        not: null
      }
    },
    select: {
      handledByUserId: true,
      status: true,
      handledByUser: {
        select: {
          name: true
        }
      },
      history: {
        select: {
          serviceTimeSeconds: true
        }
      }
    }
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
        serviceTimeCount: 0
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
  const staff = Array.from(byStaff.values()).map(s => ({
    userId: s.userId,
    name: s.name,
    ticketsHandled: s.ticketsHandled,
    completed: s.completed,
    missed: s.missed,
    averageServiceTimeSeconds: s.serviceTimeCount ? Math.round(s.serviceTimeSum / s.serviceTimeCount) : null
  })).sort((a, b) => b.ticketsHandled - a.ticketsHandled);
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    staff
  }));
}
async function getBranchComparison(req, res) {
  const {
    start,
    end
  } = parseDateRange(req.query);
  const branches = await prisma.branch.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    select: {
      id: true,
      name: true
    }
  });
  const results = await Promise.all(branches.map(async branch => {
    const [totalBookings, ticketsWithHistory, concluded] = await Promise.all([prisma.booking.count({
      where: {
        organizationId: req.tenant.organizationId,
        branchId: branch.id,
        bookingDate: {
          gte: start,
          lte: end
        },
        deletedAt: null
      }
    }), prisma.queueTicket.findMany({
      where: {
        organizationId: req.tenant.organizationId,
        branchId: branch.id,
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
            waitTimeSeconds: true
          }
        }
      }
    }), prisma.booking.findMany({
      where: {
        organizationId: req.tenant.organizationId,
        branchId: branch.id,
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
    const waitTimes = ticketsWithHistory.map(t => t.history.waitTimeSeconds).filter(v => v != null);
    const averageWaitTimeSeconds = waitTimes.length ? Math.round(waitTimes.reduce((a, v) => a + v, 0) / waitTimes.length) : null;
    const completed = concluded.filter(b => b.status === "completed").length;
    const noShow = concluded.filter(b => b.status === "no_show").length;
    return {
      branchId: branch.id,
      branchName: branch.name,
      totalBookings,
      ticketsServed: ticketsWithHistory.length,
      averageWaitTimeSeconds,
      noShowRatePercent: completed + noShow ? round1(noShow / (completed + noShow) * 100) : 0
    };
  }));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    branches: results
  }));
}
async function getRevenueReport(req, res) {
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
      status: "completed",
      deletedAt: null
    },
    select: {
      bookingDate: true,
      serviceId: true,
      service: {
        select: {
          name: true,
          price: true
        }
      }
    }
  });
  let totalRevenue = 0;
  const byServiceMap = new Map();
  const byDayMap = new Map();
  for (const b of bookings) {
    const price = b.service.price ? parseFloat(b.service.price.toString()) : 0;
    totalRevenue += price;
    const serviceKey = b.serviceId.toString();
    if (!byServiceMap.has(serviceKey)) {
      byServiceMap.set(serviceKey, {
        serviceId: b.serviceId,
        serviceName: b.service.name,
        revenue: 0,
        completedBookings: 0
      });
    }
    const serviceEntry = byServiceMap.get(serviceKey);
    serviceEntry.revenue += price;
    serviceEntry.completedBookings += 1;
    const dayK = dayKey(b.bookingDate);
    byDayMap.set(dayK, (byDayMap.get(dayK) || 0) + price);
  }
  const byService = Array.from(byServiceMap.values()).map(s => ({
    ...s,
    revenue: round1(s.revenue)
  })).sort((a, b) => b.revenue - a.revenue);
  const byDay = Array.from(byDayMap.entries()).map(([date, revenue]) => ({
    date,
    revenue: round1(revenue)
  })).sort((a, b) => a.date.localeCompare(b.date));
  return res.json(toJSONSafe({
    range: {
      startDate: dayKey(start),
      endDate: dayKey(end)
    },
    totalRevenue: round1(totalRevenue),
    currency: "GHS",
    byService,
    byDay
  }));
}
function todayRangeUTC() {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return {
    start,
    end
  };
}
const OVERLOAD_WAITING_THRESHOLD = 5;
const OVERLOAD_WAIT_SECONDS_THRESHOLD = 1800;
async function getExecutiveSummary(req, res) {
  const organizationId = req.tenant.organizationId;
  const {
    start,
    end
  } = todayRangeUTC();
  const now = new Date();
  const thisWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400000);
  const lastWeekEnd = new Date(thisWeekStart.getTime() - 1);
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthEnd = new Date(thisMonthStart.getTime() - 1);
  const [branches, allActiveTickets, todaysTickets, todaysAllBookings, todaysCompletedBookings, thisWeekBookingCount, lastWeekBookingCount, thisMonthBookingCount, lastMonthBookingCount] = await Promise.all([prisma.branch.findMany({
    where: {
      organizationId
    },
    select: {
      id: true,
      name: true
    }
  }), prisma.queueTicket.findMany({
    where: {
      organizationId,
      status: {
        in: ["waiting", "called", "serving"]
      }
    },
    select: {
      branchId: true,
      status: true,
      handledByUserId: true
    }
  }), prisma.queueTicket.findMany({
    where: {
      organizationId,
      queueDate: {
        gte: start,
        lte: end
      }
    },
    select: {
      branchId: true,
      status: true,
      handledByUserId: true,
      handledByUser: {
        select: {
          name: true
        }
      },
      history: {
        select: {
          waitTimeSeconds: true,
          serviceTimeSeconds: true
        }
      }
    }
  }), prisma.booking.findMany({
    where: {
      organizationId,
      bookingDate: {
        gte: start,
        lte: end
      },
      deletedAt: null
    },
    select: {
      branchId: true
    }
  }), prisma.booking.findMany({
    where: {
      organizationId,
      bookingDate: {
        gte: start,
        lte: end
      },
      status: "completed",
      deletedAt: null
    },
    select: {
      branchId: true,
      serviceId: true,
      service: {
        select: {
          name: true,
          price: true
        }
      }
    }
  }), prisma.booking.count({
    where: {
      organizationId,
      bookingDate: {
        gte: thisWeekStart,
        lte: end
      },
      deletedAt: null
    }
  }), prisma.booking.count({
    where: {
      organizationId,
      bookingDate: {
        gte: lastWeekStart,
        lte: lastWeekEnd
      },
      deletedAt: null
    }
  }), prisma.booking.count({
    where: {
      organizationId,
      bookingDate: {
        gte: thisMonthStart,
        lte: end
      },
      deletedAt: null
    }
  }), prisma.booking.count({
    where: {
      organizationId,
      bookingDate: {
        gte: lastMonthStart,
        lte: lastMonthEnd
      },
      deletedAt: null
    }
  })]);
  const activeCounters = await prisma.serviceCounter.count({
    where: {
      organizationId,
      status: "open"
    }
  });
  const customersWaiting = allActiveTickets.filter(t => t.status === "waiting").length;
  const customersServing = allActiveTickets.filter(t => t.status === "serving").length;
  const customersCompletedToday = todaysTickets.filter(t => t.status === "completed").length;
  const activeStaffIds = new Set(allActiveTickets.map(t => t.handledByUserId).filter(Boolean).map(id => id.toString()));
  const waitTimesToday = todaysTickets.map(t => t.history?.waitTimeSeconds).filter(v => v != null);
  const serviceTimesToday = todaysTickets.map(t => t.history?.serviceTimeSeconds).filter(v => v != null);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length) : null;
  const branchRanking = branches.map(branch => {
    const branchActiveTickets = allActiveTickets.filter(t => t.branchId === branch.id);
    const branchTodayTickets = todaysTickets.filter(t => t.branchId === branch.id);
    const branchWaitTimes = branchTodayTickets.map(t => t.history?.waitTimeSeconds).filter(v => v != null);
    const waiting = branchActiveTickets.filter(t => t.status === "waiting").length;
    const averageWaitTimeSeconds = branchWaitTimes.length ? Math.round(branchWaitTimes.reduce((a, v) => a + v, 0) / branchWaitTimes.length) : null;
    const branchCompleted = branchTodayTickets.filter(t => t.status === "completed").length;
    const branchMissed = branchTodayTickets.filter(t => t.status === "missed").length;
    const branchStaffIds = new Set(branchTodayTickets.map(t => t.handledByUserId).filter(Boolean).map(id => id.toString()));
    return {
      branchId: branch.id,
      branchName: branch.name,
      customersWaiting: waiting,
      ticketsServedToday: branchCompleted,
      bookingsToday: todaysAllBookings.filter(b => b.branchId === branch.id).length,
      staffAvailable: branchStaffIds.size,
      queueEfficiencyPercent: branchCompleted + branchMissed > 0 ? round1(branchCompleted / (branchCompleted + branchMissed) * 100) : null,
      averageWaitTimeSeconds,
      overloaded: waiting > OVERLOAD_WAITING_THRESHOLD || (averageWaitTimeSeconds || 0) > OVERLOAD_WAIT_SECONDS_THRESHOLD
    };
  }).sort((a, b) => b.ticketsServedToday - a.ticketsServedToday);
  const serviceCounts = new Map();
  let todaysRevenue = 0;
  for (const b of todaysCompletedBookings) {
    const key = b.serviceId.toString();
    if (!serviceCounts.has(key)) serviceCounts.set(key, {
      serviceId: b.serviceId,
      serviceName: b.service.name,
      count: 0
    });
    serviceCounts.get(key).count += 1;
    todaysRevenue += b.service.price ? parseFloat(b.service.price.toString()) : 0;
  }
  const serviceRanking = Array.from(serviceCounts.values()).sort((a, b) => b.count - a.count);
  const overloadedBranches = branchRanking.filter(b => b.overloaded);
  const staffCompletedCounts = new Map();
  for (const t of todaysTickets) {
    if (t.status !== "completed" || !t.handledByUserId) continue;
    const key = t.handledByUserId.toString();
    if (!staffCompletedCounts.has(key)) {
      staffCompletedCounts.set(key, {
        userId: t.handledByUserId,
        name: t.handledByUser?.name || "Unknown",
        completed: 0
      });
    }
    staffCompletedCounts.get(key).completed += 1;
  }
  const bestStaff = Array.from(staffCompletedCounts.values()).sort((a, b) => b.completed - a.completed)[0] || null;
  const branchesWithWaitData = branchRanking.filter(b => b.averageWaitTimeSeconds != null);
  const highestWaitBranch = branchesWithWaitData.length ? [...branchesWithWaitData].sort((a, b) => b.averageWaitTimeSeconds - a.averageWaitTimeSeconds)[0] : null;
  const lowestWaitBranch = branchesWithWaitData.length ? [...branchesWithWaitData].sort((a, b) => a.averageWaitTimeSeconds - b.averageWaitTimeSeconds)[0] : null;
  return res.json(toJSONSafe({
    generatedAt: new Date().toISOString(),
    live: {
      customersWaiting,
      customersServing,
      activeStaffCount: activeStaffIds.size,
      activeCounters
    },
    today: {
      customersCompleted: customersCompletedToday,
      averageWaitTimeSeconds: avg(waitTimesToday),
      averageServiceTimeSeconds: avg(serviceTimesToday),
      revenue: round1(todaysRevenue)
    },
    branchRanking,
    serviceRanking,
    alerts: overloadedBranches.map(b => ({
      branchId: b.branchId,
      branchName: b.branchName,
      reason: b.customersWaiting > OVERLOAD_WAITING_THRESHOLD ? `${b.customersWaiting} customers currently waiting` : `Average wait today is ${Math.round((b.averageWaitTimeSeconds || 0) / 60)} minutes`
    })),
    summary: {
      weeklyGrowthPercent: computeGrowth(thisWeekBookingCount, lastWeekBookingCount),
      monthlyGrowthPercent: computeGrowth(thisMonthBookingCount, lastMonthBookingCount),
      bestBranch: branchRanking[0] ? {
        branchId: branchRanking[0].branchId,
        branchName: branchRanking[0].branchName,
        ticketsServedToday: branchRanking[0].ticketsServedToday
      } : null,
      bestStaff,
      mostRequestedService: serviceRanking[0] || null,
      highestWaitBranch: highestWaitBranch ? {
        branchId: highestWaitBranch.branchId,
        branchName: highestWaitBranch.branchName,
        averageWaitTimeSeconds: highestWaitBranch.averageWaitTimeSeconds
      } : null,
      lowestWaitBranch: lowestWaitBranch ? {
        branchId: lowestWaitBranch.branchId,
        branchName: lowestWaitBranch.branchName,
        averageWaitTimeSeconds: lowestWaitBranch.averageWaitTimeSeconds
      } : null
    }
  }));
}
function computeGrowth(current, previous) {
  if (!previous) return null;
  return round1((current - previous) / previous * 100);
}
function dayBounds(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return {
    start,
    end
  };
}
function computeTrend(todayValue, yesterdayValue) {
  if (yesterdayValue == null || yesterdayValue === 0) return null;
  return round1((todayValue - yesterdayValue) / yesterdayValue * 100);
}
async function computeDayStats(organizationId, dayStart, dayEnd) {
  const [bookings, tickets] = await Promise.all([prisma.booking.findMany({
    where: {
      organizationId,
      bookingDate: {
        gte: dayStart,
        lte: dayEnd
      },
      deletedAt: null
    },
    select: {
      status: true
    }
  }), prisma.queueTicket.findMany({
    where: {
      organizationId,
      queueDate: {
        gte: dayStart,
        lte: dayEnd
      }
    },
    select: {
      status: true,
      handledByUserId: true,
      history: {
        select: {
          waitTimeSeconds: true,
          serviceTimeSeconds: true
        }
      }
    }
  })]);
  const waitTimes = tickets.map(t => t.history?.waitTimeSeconds).filter(v => v != null);
  const serviceTimes = tickets.map(t => t.history?.serviceTimeSeconds).filter(v => v != null);
  const avg = arr => arr.length ? Math.round(arr.reduce((a, v) => a + v, 0) / arr.length) : null;
  const customersServed = tickets.filter(t => t.status === "completed").length;
  const missedCustomers = tickets.filter(t => t.status === "missed").length;
  const activeStaffIds = new Set(tickets.map(t => t.handledByUserId).filter(Boolean).map(id => id.toString()));
  return {
    bookings: bookings.length,
    queueTickets: tickets.length,
    customersServed,
    averageWaitTimeSeconds: avg(waitTimes),
    averageServiceTimeSeconds: avg(serviceTimes),
    activeStaff: activeStaffIds.size,
    completedAppointments: bookings.filter(b => b.status === "completed").length,
    cancelledAppointments: bookings.filter(b => b.status === "cancelled").length,
    missedCustomers,
    queueEfficiencyPercent: customersServed + missedCustomers > 0 ? round1(customersServed / (customersServed + missedCustomers) * 100) : null
  };
}
async function getHomeDashboard(req, res) {
  const organizationId = req.tenant.organizationId;
  const todayRange = dayBounds(0);
  const yesterdayRange = dayBounds(1);
  const [todayStats, yesterdayStats, liveTickets, activeCounters, activeBranches, weekTickets, weekBookings] = await Promise.all([computeDayStats(organizationId, todayRange.start, todayRange.end), computeDayStats(organizationId, yesterdayRange.start, yesterdayRange.end), prisma.queueTicket.findMany({
    where: {
      organizationId,
      status: {
        in: ["waiting", "serving"]
      }
    },
    select: {
      status: true
    }
  }), prisma.serviceCounter.count({
    where: {
      organizationId,
      status: "open"
    }
  }), prisma.branch.count({
    where: {
      organizationId,
      status: "active"
    }
  }), prisma.queueTicket.findMany({
    where: {
      organizationId,
      queueDate: {
        gte: dayBounds(6).start,
        lte: todayRange.end
      }
    },
    select: {
      queueDate: true
    }
  }), prisma.booking.findMany({
    where: {
      organizationId,
      bookingDate: {
        gte: dayBounds(6).start,
        lte: todayRange.end
      },
      deletedAt: null
    },
    select: {
      bookingDate: true
    }
  })]);
  function trendCard(key, goodDirection = "up") {
    return {
      value: todayStats[key],
      trendPercent: computeTrend(todayStats[key], yesterdayStats[key]),
      goodDirection
    };
  }
  function dayKeyRange(daysBack) {
    const keys = [];
    for (let i = daysBack; i >= 0; i--) keys.push(dayKey(dayBounds(i).start));
    return keys;
  }
  const last7Days = dayKeyRange(6);
  const queueActivityByDay = Object.fromEntries(last7Days.map(d => [d, 0]));
  for (const t of weekTickets) queueActivityByDay[dayKey(t.queueDate)] = (queueActivityByDay[dayKey(t.queueDate)] || 0) + 1;
  const bookingsByDay = Object.fromEntries(last7Days.map(d => [d, 0]));
  for (const b of weekBookings) bookingsByDay[dayKey(b.bookingDate)] = (bookingsByDay[dayKey(b.bookingDate)] || 0) + 1;
  return res.json(toJSONSafe({
    generatedAt: new Date().toISOString(),
    live: {
      customersWaiting: liveTickets.filter(t => t.status === "waiting").length,
      customersServing: liveTickets.filter(t => t.status === "serving").length,
      activeCounters,
      activeBranches
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
      queueEfficiencyPercent: trendCard("queueEfficiencyPercent")
    },
    queueActivityTrend: last7Days.map(date => ({
      date,
      count: queueActivityByDay[date]
    })),
    bookingsTrend: last7Days.map(date => ({
      date,
      count: bookingsByDay[date]
    }))
  }));
}
module.exports = {
  getServicePopularity,
  getPeakHours,
  getBookingTrends,
  getStaffPerformance,
  getBranchComparison,
  getRevenueReport,
  getExecutiveSummary,
  getHomeDashboard
};