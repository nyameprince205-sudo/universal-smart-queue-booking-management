const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const prisma = require("../src/config/db");

// Everything a FRESH database needs before the platform can function at
// all. Without this, a new deployment has tables but no roles (so no
// account can be assigned one), no business types (so no organization can
// be created or approved), and no plans (so subscriptions break).
//
// Safe to run more than once — every write is an upsert keyed on a unique
// column, so re-running updates rather than duplicating. That matters for
// deployment platforms that may run the seed on every deploy.

const ROLES = [
  { name: "SUPER_ADMIN", description: "Platform operator — manages all organizations" },
  { name: "ORG_ADMIN", description: "Business owner — manages one organization" },
  { name: "STAFF", description: "Branch staff — serves customers at a counter" },
];

const BUSINESS_TYPES = [
  { name: "Restaurant", description: "Restaurants, cafes and eateries" },
  { name: "Hospital", description: "Hospitals, clinics and health centres" },
  { name: "Salon", description: "Salons, barbershops and spas" },
  { name: "Bank", description: "Banks and financial services" },
  { name: "Government Office", description: "Public service offices" },
  { name: "Pharmacy", description: "Pharmacies and dispensaries" },
  { name: "Other", description: "Any other service business" },
];

const PLANS = [
  { name: "Trial", price: 0, billingCycle: "monthly", maxBranches: 1, maxUsers: 3 },
  { name: "Starter", price: 150, billingCycle: "monthly", maxBranches: 2, maxUsers: 10 },
  { name: "Business", price: 400, billingCycle: "monthly", maxBranches: 5, maxUsers: 30 },
  { name: "Enterprise", price: 1000, billingCycle: "monthly", maxBranches: null, maxUsers: null },
];

async function seedRoles() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  console.log(`Roles seeded (${ROLES.length})`);
}

async function seedBusinessTypes() {
  for (const bt of BUSINESS_TYPES) {
    await prisma.businessType.upsert({
      where: { name: bt.name },
      update: { description: bt.description },
      create: bt,
    });
  }
  console.log(`Business types seeded (${BUSINESS_TYPES.length})`);
}

async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: plan,
      create: plan,
    });
  }
  console.log(`Plans seeded (${PLANS.length})`);
}

// The first Super Admin. Credentials come from the environment rather than
// being hardcoded — a default password committed to a public repository
// would be an open door on any real deployment. Skipped entirely if the
// variables aren't set, so this script stays safe to run anywhere.
async function seedSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("Super admin skipped — set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to create one");
    return;
  }

  const role = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" } });
  if (!role) throw new Error("SUPER_ADMIN role missing — seedRoles must run first");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Super admin already exists (${email}) — left unchanged`);
    return;
  }

  await prisma.user.create({
    data: {
      uuid: randomUUID(),
      name: process.env.SUPER_ADMIN_NAME || "Platform Administrator",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      roleId: role.id,
      organizationId: null,
      branchId: null,
      status: "active",
      emailVerified: true,
    },
  });
  console.log(`Super admin created (${email})`);
}

async function main() {
  // Order matters: the super admin needs the SUPER_ADMIN role to exist.
  await seedRoles();
  await seedBusinessTypes();
  await seedPlans();
  await seedSuperAdmin();
  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
