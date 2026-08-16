const prisma = require("../config/db");
async function activateSubscriptionFromPayment({
  reference,
  paystackData
}) {
  const payment = await prisma.payment.findUnique({
    where: {
      gatewayReference: reference
    }
  });
  if (!payment) {
    throw httpError(404, `No payment record found for reference ${reference}`);
  }
  if (payment.status === "successful") {
    const existingSub = payment.subscriptionId ? await prisma.subscription.findUnique({
      where: {
        id: payment.subscriptionId
      }
    }) : null;
    return {
      alreadyProcessed: true,
      subscription: existingSub
    };
  }
  if (paystackData.status !== "success") {
    await prisma.payment.update({
      where: {
        id: payment.id
      },
      data: {
        status: "failed"
      }
    });
    throw httpError(400, `Payment was not successful (Paystack status: ${paystackData.status})`);
  }
  const planId = Number(paystackData.metadata?.planId);
  const organizationId = payment.organizationId;
  const plan = await prisma.plan.findUnique({
    where: {
      id: planId
    }
  });
  if (!plan) throw httpError(400, "Payment metadata did not include a valid planId");
  const startDate = new Date();
  const endDate = new Date(startDate);
  if (plan.billingCycle === "yearly") endDate.setFullYear(endDate.getFullYear() + 1);else endDate.setMonth(endDate.getMonth() + 1);
  const existingSubscription = await prisma.subscription.findFirst({
    where: {
      organizationId,
      status: {
        in: ["trial", "active"]
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const result = await prisma.$transaction(async tx => {
    if (existingSubscription) {
      await tx.subscription.update({
        where: {
          id: existingSubscription.id
        },
        data: {
          status: "expired"
        }
      });
    }
    const subscription = await tx.subscription.create({
      data: {
        organizationId,
        planId,
        startDate,
        endDate,
        status: "active",
        autoRenew: true
      }
    });
    await tx.payment.update({
      where: {
        id: payment.id
      },
      data: {
        status: "successful",
        paidAt: new Date(),
        subscriptionId: subscription.id
      }
    });
    await tx.subscriptionTransaction.create({
      data: {
        subscriptionId: subscription.id,
        paymentId: payment.id,
        transactionType: existingSubscription ? "renewal" : "new",
        oldPlanId: existingSubscription ? existingSubscription.planId : null,
        newPlanId: planId
      }
    });
    await tx.organization.update({
      where: {
        id: organizationId
      },
      data: {
        status: "active"
      }
    });
    return subscription;
  });
  return {
    alreadyProcessed: false,
    subscription: result
  };
}
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
module.exports = {
  activateSubscriptionFromPayment
};