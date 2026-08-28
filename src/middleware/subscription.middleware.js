const prisma = require("../config/db");
async function resolveSubscriptionState(organizationId) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId,
      status: {
        in: ["trial", "active"]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      plan: true
    }
  });
  if (!subscription) {
    return {
      hasAccess: false,
      state: "none",
      subscription: null,
      daysRemaining: 0,
      reason: "This organization has no active subscription."
    };
  }
  const now = new Date();
  const endDate = new Date(subscription.endDate);
  const accessEndsAt = new Date(endDate);
  accessEndsAt.setHours(23, 59, 59, 999);
  if (accessEndsAt.getTime() - now.getTime() <= 0) {
    return {
      hasAccess: false,
      state: "expired",
      subscription,
      daysRemaining: 0,
      reason: subscription.status === "trial" ? "Your 30-day access period has expired." : "Your subscription has expired."
    };
  }
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endMidnight = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const daysRemaining = Math.max(0, Math.round((endMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)));
  return {
    hasAccess: true,
    state: subscription.status === "trial" ? "trial" : "active",
    subscription,
    daysRemaining,
    reason: null
  };
}
function requireActiveSubscription(req, res, next) {
  if (req.auth?.role === "SUPER_ADMIN") return next();
  const organizationId = req.tenant?.organizationId || req.body?.organizationId;
  if (!organizationId) {
    return res.status(403).json({
      error: "No organization context for this request"
    });
  }
  resolveSubscriptionState(BigInt(organizationId)).then(state => {
    if (state.hasAccess) {
      req.subscription = state;
      return next();
    }
    return res.status(402).json({
      error: state.reason,
      subscriptionRequired: true,
      state: state.state
    });
  }).catch(next);
}
async function expireSubscriptions() {
  const now = new Date();
  const result = await prisma.subscription.updateMany({
    where: {
      status: {
        in: ["trial", "active"]
      },
      endDate: {
        lt: now
      }
    },
    data: {
      status: "expired"
    }
  });
  return result.count;
}
module.exports = {
  requireActiveSubscription,
  resolveSubscriptionState,
  expireSubscriptions
};