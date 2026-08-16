const {
  randomUUID
} = require("crypto");
const prisma = require("../config/db");
const {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature
} = require("../services/paystack.service");
const {
  activateSubscriptionFromPayment
} = require("../services/subscription.service");
async function listPlans(req, res) {
  const plans = await prisma.plan.findMany({
    where: {
      isActive: true
    },
    include: {
      features: true
    },
    orderBy: {
      price: "asc"
    }
  });
  return res.json(plans.map(p => ({
    id: p.id,
    name: p.name,
    price: p.price.toString(),
    billingCycle: p.billingCycle,
    maxBranches: p.maxBranches,
    maxUsers: p.maxUsers,
    features: p.features.map(f => ({
      key: f.featureKey,
      value: f.featureValue
    }))
  })));
}
async function getMySubscription(req, res) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId: req.tenant.organizationId,
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
  if (!subscription) return res.json({
    subscription: null,
    message: "No active subscription"
  });
  return res.json({
    id: subscription.id.toString(),
    plan: subscription.plan.name,
    status: subscription.status,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
    autoRenew: subscription.autoRenew
  });
}
async function initializeSubscription(req, res) {
  const {
    planId
  } = req.body;
  if (!planId) return res.status(400).json({
    error: "planId is required"
  });
  const plan = await prisma.plan.findUnique({
    where: {
      id: Number(planId)
    }
  });
  if (!plan || !plan.isActive) return res.status(404).json({
    error: "Plan not found"
  });
  const organization = await prisma.organization.findUnique({
    where: {
      id: req.tenant.organizationId
    }
  });
  const reference = `qsaas_${req.tenant.organizationId}_${Date.now()}`;
  const amountKobo = Math.round(Number(plan.price) * 100);
  const payment = await prisma.payment.create({
    data: {
      uuid: randomUUID(),
      organizationId: req.tenant.organizationId,
      amount: plan.price,
      currency: "GHS",
      gateway: "paystack",
      gatewayReference: reference,
      status: "pending"
    }
  });
  const paystackResponse = await initializeTransaction({
    email: organization.email,
    amountKobo,
    reference,
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL || "http://localhost:4000/api/v1/subscriptions/callback",
    metadata: {
      organizationId: req.tenant.organizationId.toString(),
      planId: plan.id
    }
  });
  return res.status(201).json({
    paymentId: payment.id.toString(),
    reference,
    authorizationUrl: paystackResponse.authorization_url
  });
}
async function verifySubscriptionPayment(req, res) {
  const {
    reference
  } = req.params;
  const paystackData = await verifyTransaction(reference);
  const result = await activateSubscriptionFromPayment({
    reference,
    paystackData
  });
  return res.json({
    alreadyProcessed: result.alreadyProcessed,
    subscription: result.subscription ? {
      id: result.subscription.id.toString(),
      status: result.subscription.status,
      endDate: result.subscription.endDate
    } : null
  });
}
async function paystackWebhook(req, res) {
  const signature = req.headers["x-paystack-signature"];
  if (!verifyWebhookSignature(req.rawBody, signature)) {
    console.warn("[paystack webhook] signature verification FAILED — ignoring request");
    return res.status(400).json({
      error: "Invalid signature"
    });
  }
  const event = req.body;
  if (event.event === "charge.success") {
    try {
      await activateSubscriptionFromPayment({
        reference: event.data.reference,
        paystackData: event.data
      });
    } catch (err) {
      console.error("[paystack webhook] failed to activate subscription:", err.message);
    }
  }
  return res.status(200).json({
    received: true
  });
}
async function listPaymentHistory(req, res) {
  const payments = await prisma.payment.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 20
  });
  return res.json(payments.map(p => ({
    id: p.id.toString(),
    amount: p.amount.toString(),
    currency: p.currency,
    status: p.status,
    gatewayReference: p.gatewayReference,
    paidAt: p.paidAt,
    createdAt: p.createdAt
  })));
}
module.exports = {
  listPlans,
  getMySubscription,
  initializeSubscription,
  verifySubscriptionPayment,
  paystackWebhook,
  listPaymentHistory
};