const prisma = require("../config/db");

// This is the ONE place that turns "a payment succeeded" into "this
// organization's subscription is now active." Both the webhook handler
// (production path) and the manual /verify endpoint (local-dev path,
// since Paystack can't reach your localhost) call this exact same
// function — so however the confirmation arrives, the business outcome
// is identical, computed in exactly one place.
//
// IDEMPOTENT ON PURPOSE: Paystack can and does redeliver webhooks (network
// blips, retries on a slow response). If this function runs twice for the
// same successful payment, the second run must be a safe no-op, not a
// second subscription or a doubled billing period. That's why the very
// first thing it does is check whether this payment was already processed.
async function activateSubscriptionFromPayment({ reference, paystackData }) {
  const payment = await prisma.payment.findUnique({ where: { gatewayReference: reference } });
  if (!payment) {
    throw httpError(404, `No payment record found for reference ${reference}`);
  }

  if (payment.status === "successful") {
    // Already processed — this is the idempotency guard. Returning the
    // existing subscription instead of erroring means a redelivered
    // webhook is harmless, not a failure.
    const existingSub = payment.subscriptionId
      ? await prisma.subscription.findUnique({ where: { id: payment.subscriptionId } })
      : null;
    return { alreadyProcessed: true, subscription: existingSub };
  }

  if (paystackData.status !== "success") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "failed" } });
    throw httpError(400, `Payment was not successful (Paystack status: ${paystackData.status})`);
  }

  const planId = Number(paystackData.metadata?.planId);
  const organizationId = payment.organizationId;

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw httpError(400, "Payment metadata did not include a valid planId");

  const startDate = new Date();
  const endDate = new Date(startDate);
  if (plan.billingCycle === "yearly") endDate.setFullYear(endDate.getFullYear() + 1);
  else endDate.setMonth(endDate.getMonth() + 1);

  const existingSubscription = await prisma.subscription.findFirst({
    where: { organizationId, status: { in: ["trial", "active"] } },
    orderBy: { createdAt: "desc" },
  });

  const result = await prisma.$transaction(async (tx) => {
    // Mark any current trial/active subscription as no longer active before
    // creating the new one — an org should only ever have ONE active
    // subscription at a time, and history (past subscriptions) is kept as
    // rows rather than overwritten, matching the "subscriptions has many
    // rows per org over time" design from DATABASE_DESIGN.md.
    if (existingSubscription) {
      await tx.subscription.update({
        where: { id: existingSubscription.id },
        data: { status: "expired" },
      });
    }

    const subscription = await tx.subscription.create({
      data: {
        organizationId,
        planId,
        startDate,
        endDate,
        status: "active",
        autoRenew: true,
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "successful", paidAt: new Date(), subscriptionId: subscription.id },
    });

    await tx.subscriptionTransaction.create({
      data: {
        subscriptionId: subscription.id,
        paymentId: payment.id,
        transactionType: existingSubscription ? "renewal" : "new",
        oldPlanId: existingSubscription ? existingSubscription.planId : null,
        newPlanId: planId,
      },
    });

    // Organization moves out of "trial" status the moment they have a
    // genuine paid, active subscription — status on the organization
    // itself (not just the subscription row) is what tenant-facing
    // feature gating would check later.
    await tx.organization.update({
      where: { id: organizationId },
      data: { status: "active" },
    });

    return subscription;
  });

  return { alreadyProcessed: false, subscription: result };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { activateSubscriptionFromPayment };
