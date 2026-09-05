const prisma = require("../config/db");
const DEFAULT_SERVICE_SECONDS = 600;
async function averageServiceSecondsFor(organizationId) {
  try {
    const result = await prisma.queueHistory.aggregate({
      _avg: {
        serviceTimeSeconds: true
      },
      where: {
        serviceTimeSeconds: {
          not: null
        },
        queueTicket: {
          is: {
            organizationId
          }
        }
      }
    });
    const avg = result?._avg?.serviceTimeSeconds;
    return avg && avg > 0 ? Math.round(avg) : DEFAULT_SERVICE_SECONDS;
  } catch {
    return DEFAULT_SERVICE_SECONDS;
  }
}
async function getPublicQueueStatus(req, res) {
  const organization = await prisma.organization.findUnique({
    where: {
      slug: req.params.slug
    },
    select: {
      id: true,
      name: true,
      status: true,
      branches: {
        where: {
          status: "active"
        },
        select: {
          id: true,
          name: true
        }
      }
    }
  });
  if (!organization) {
    return res.status(404).json({
      error: "Organization not found"
    });
  }
  if (["suspended", "cancelled"].includes(organization.status)) {
    return res.json({
      organization: organization.name,
      branches: []
    });
  }
  const branches = await Promise.all(organization.branches.map(async branch => {
    const [waiting, openCounters, avgServiceSeconds, serving] = await Promise.all([prisma.queueTicket.count({
      where: {
        organizationId: organization.id,
        branchId: branch.id,
        status: "waiting"
      }
    }), prisma.serviceCounter.count({
      where: {
        organizationId: organization.id,
        branchId: branch.id,
        status: "open"
      }
    }), averageServiceSecondsFor(organization.id), prisma.queueTicket.findFirst({
      where: {
        organizationId: organization.id,
        branchId: branch.id,
        status: {
          in: ["called", "serving"]
        }
      },
      orderBy: {
        calledAt: "desc"
      },
      select: {
        ticketNumber: true
      }
    })]);
    const counters = Math.max(openCounters, 1);
    const roundsAhead = Math.ceil((waiting + 1) / counters);
    const estimatedWaitSeconds = roundsAhead * avgServiceSeconds;
    return {
      branchId: branch.id.toString(),
      branchName: branch.name,
      waiting,
      openCounters,
      nowServing: serving?.ticketNumber || null,
      estimatedWaitSeconds,
      estimatedWaitMinutes: Math.max(1, Math.round(estimatedWaitSeconds / 60)),
      busyness: waiting === 0 ? "quiet" : waiting <= 5 ? "moderate" : "busy"
    };
  }));
  return res.json({
    organization: organization.name,
    branches
  });
}
let statsCache = {
  value: null,
  expiresAt: 0
};
const STATS_CACHE_MS = 15000;
async function getPlatformQueueStats(req, res) {
  const now = Date.now();
  if (statsCache.value && now < statsCache.expiresAt) {
    return res.json(statsCache.value);
  }
  const [waitingNow, activeOrganizations, servedToday, busiestRaw] = await Promise.all([prisma.queueTicket.count({
    where: {
      status: "waiting"
    }
  }), prisma.organization.count({
    where: {
      status: {
        in: ["trial", "active"]
      }
    }
  }), prisma.queueTicket.count({
    where: {
      status: "completed",
      queueDate: new Date(new Date().toISOString().slice(0, 10))
    }
  }), prisma.queueTicket.groupBy({
    by: ["organizationId"],
    where: {
      status: "waiting"
    },
    _count: {
      _all: true
    }
  })]);
  const allOrgs = await prisma.organization.findMany({
    where: {
      status: {
        in: ["trial", "active"]
      }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      businessType: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      name: "asc"
    },
    take: 12
  });
  const servingNow = allOrgs.length ? await prisma.queueTicket.findMany({
    where: {
      organizationId: {
        in: allOrgs.map(o => o.id)
      },
      status: {
        in: ["called", "serving"]
      }
    },
    orderBy: {
      calledAt: "desc"
    },
    select: {
      organizationId: true,
      ticketNumber: true,
      calledAt: true
    }
  }) : [];
  const busiest = await Promise.all(allOrgs.map(async org => {
    const waiting = busiestRaw.find(b => String(b.organizationId) === String(org.id))?._count?._all || 0;
    const serving = servingNow.find(t => String(t.organizationId) === String(org.id));
    const avgServiceSeconds = await averageServiceSecondsFor(org.id);
    const estimatedWaitMinutes = waiting > 0 ? Math.max(1, Math.round((waiting + 1) * avgServiceSeconds / 60)) : 0;
    return {
      name: org.name,
      slug: org.slug,
      businessType: org.businessType?.name || null,
      waiting,
      nowServing: serving?.ticketNumber || null,
      estimatedWaitMinutes
    };
  }));
  busiest.sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name));
  const value = {
    waitingNow,
    activeOrganizations,
    servedToday,
    busiest
  };
  statsCache = {
    value,
    expiresAt: now + STATS_CACHE_MS
  };
  return res.json(value);
}
module.exports = {
  getPublicQueueStatus,
  getPlatformQueueStats
};