const prisma = require("../src/config/db");

// One-off backfill. Every organization approved BEFORE trial-on-approval
// existed has no subscription row at all — and the new middleware fails
// closed, so the moment enforcement goes live those organizations would
// be locked out of their own system with no explanation.
//
// This gives each of them a 30-day period starting now. Deliberately not
// backdated to their creation date: an organization that has been running
// for two months would otherwise be born already expired, which punishes
// them for a change they had no part in.
//
// Safe to run more than once — organizations that already have a live
// subscription are skipped, so a second run does nothing rather than
// granting a second period.

const TRIAL_DAYS = 30;

async function main() {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  if (organizations.length === 0) {
    console.log("No organizations found — nothing to backfill.");
    return;
  }

  const trialPlan =
    (await prisma.plan.findFirst({ where: { name: "Trial" } })) ||
    (await prisma.plan.findFirst({ orderBy: { price: "asc" } }));

  if (!trialPlan) {
    console.error("No plans exist. Run `node prisma/seed.js` first, then re-run this.");
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;

  for (const org of organizations) {
    const existing = await prisma.subscription.findFirst({
      where: { organizationId: org.id, status: { in: ["trial", "active"] } },
    });

    if (existing) {
      console.log(`  skipped  ${org.name} — already has a ${existing.status} subscription`);
      skipped++;
      continue;
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + TRIAL_DAYS);

    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planId: trialPlan.id,
        startDate,
        endDate,
        status: "trial",
        autoRenew: false,
      },
    });

    console.log(`  created  ${org.name} — 30-day access until ${endDate.toDateString()}`);
    created++;
  }

  console.log("");
  console.log(`Done. ${created} created, ${skipped} already had one.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
