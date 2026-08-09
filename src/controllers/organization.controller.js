const prisma = require("../config/db");
const { randomUUID } = require("crypto");
const { toJSONSafe } = require("../utils/serialize");

// IMPORTANT ARCHITECTURAL NOTE, worth reading before anything else:
// `organizations` is the ONE table in this entire schema that does NOT have
// an organization_id column — because it IS the tenant, not something that
// belongs to one. That means routes touching this table split into two
// completely different families:
//
//   PLATFORM-LEVEL routes (Super Admin) — see organization.routes.js — run
//   authenticate + requireRole("SUPER_ADMIN") but deliberately SKIP
//   requireTenant, because a Super Admin has no organizationId at all.
//   These can see/touch ANY organization.
//
//   TENANT-SCOPED routes (Org Admin managing their OWN org) — run
//   authenticate + requireTenant + requireRole("ORG_ADMIN") like every other
//   tenant feature, and only ever touch req.tenant.organizationId.
//
// Mixing these two up is the single easiest way to accidentally let one
// business see another's data, so the split is enforced by which
// middleware chain a route uses, not by an if-check inside the controller.

// ---- Public (no auth) — customer-facing discovery ----

// A customer needs to find an organization's active branches and services
// BEFORE they can book anything — but every other route in this file
// requires either SUPER_ADMIN or an authenticated tenant staff member.
// This is the ONE deliberately public read in the whole organizations API:
// enough to build a booking page (name, active branches, active services),
// nothing sensitive (no email, no settings, no counts of inactive/deleted
// records that could leak business info to a competitor poking at the URL).
async function getPublicOrganization(req, res) {
  const organization = await prisma.organization.findUnique({
    where: { slug: req.params.slug },
    include: {
      branches: { where: { status: "active" } },
      services: { where: { isActive: true } },
    },
  });

  // A cancelled organization is treated the same as "doesn't exist" here —
  // there's no reason a public storefront page should still resolve for a
  // business that's shut down on the platform.
  if (!organization || organization.status === "cancelled") {
    return res.status(404).json({ error: "Organization not found" });
  }

  return res.json(
    toJSONSafe({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl,
      branches: organization.branches,
      services: organization.services,
    })
  );
}

// Phase 16, Module 3 addition: a customer needs to FIND an organization
// before they can even get to getPublicOrganization above — until now the
// only way to reach a business's booking page was already having its
// direct /book/:slug link (a deliberate earlier design choice, since
// reversed based on real usage: a platform with many businesses on it
// needs an in-app way to search/browse them, not just shareable links).
// Same public trust boundary as getPublicOrganization — name, slug, logo,
// business type only, nothing sensitive, and the same `status !==
// cancelled` exclusion so a shut-down business doesn't show up to browse
// any more than its direct link still resolves.
async function searchPublicOrganizations(req, res) {
  const search = req.query.search?.trim();

  const organizations = await prisma.organization.findMany({
    where: {
      status: { not: "cancelled" },
      ...(search ? { name: { contains: search } } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      businessType: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return res.json(toJSONSafe(organizations));
}

// ---- Platform-level (Super Admin) ----

async function createOrganization(req, res) {
  const { name, email, businessTypeId, phone, logoUrl } = req.body;

  if (!name || !email || !businessTypeId) {
    return res.status(400).json({ error: "name, email, and businessTypeId are required" });
  }

  const slug = slugify(name);

  // Creating the organization AND its settings row together, in one
  // transaction, means you can never end up with an organization that's
  // missing its settings row (which organization_settings.organization_id
  // being UNIQUE and NOT NULL already assumes exists everywhere else in
  // the codebase — better to guarantee it here than defend against its
  // absence in every controller that reads settings later).
  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        uuid: randomUUID(),
        businessTypeId: Number(businessTypeId),
        name,
        slug,
        email,
        phone: phone || null,
        logoUrl: logoUrl || null,
        status: "trial",
      },
    });

    await tx.organizationSettings.create({
      data: {
        organizationId: org.id,
        queuePrefix: name.trim().charAt(0).toUpperCase() || "Q",
        timezone: "Africa/Accra",
      },
    });

    return org;
  });

  return res.status(201).json(serializeOrg(organization));
}

async function listOrganizations(req, res) {
  // No organizationId filter anywhere in this function — this is the ONE
  // controller in the whole project where that's correct, not a bug,
  // because only SUPER_ADMIN-guarded routes ever call it.
  const organizations = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { businessType: true },
  });

  return res.json(organizations.map(serializeOrg));
}

async function getOrganization(req, res) {
  const organization = await prisma.organization.findUnique({
    where: { id: BigInt(req.params.id) },
    include: { businessType: true, settings: true },
  });

  if (!organization) return res.status(404).json({ error: "Organization not found" });
  return res.json(serializeOrg(organization));
}

async function updateOrganizationStatus(req, res) {
  const { status } = req.body;
  const allowed = ["trial", "active", "suspended", "cancelled"];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  const organization = await prisma.organization.update({
    where: { id: BigInt(req.params.id) },
    data: { status },
  });

  return res.json(serializeOrg(organization));
}

// ---- Tenant-scoped (Org Admin managing their OWN organization) ----

async function getMyOrganization(req, res) {
  // Notice: req.tenant.organizationId (set by requireTenant), never
  // req.params.id. An Org Admin has no way to even ASK for another
  // organization's data through this route — there's no id parameter here
  // for them to tamper with in the first place.
  const organization = await prisma.organization.findUnique({
    where: { id: req.tenant.organizationId },
    include: { businessType: true, settings: true },
  });

  if (!organization) return res.status(404).json({ error: "Organization not found" });
  return res.json(serializeOrg(organization));
}

async function updateMyOrganization(req, res) {
  const { name, phone, logoUrl, queuePrefix, timezone } = req.body;

  const organization = await prisma.organization.update({
    where: { id: req.tenant.organizationId },
    data: {
      name: name || undefined,
      phone: phone || undefined,
      logoUrl: logoUrl || undefined,
    },
  });

  if (queuePrefix || timezone) {
    await prisma.organizationSettings.update({
      where: { organizationId: req.tenant.organizationId },
      data: {
        queuePrefix: queuePrefix || undefined,
        timezone: timezone || undefined,
      },
    });
  }

  return res.json(serializeOrg(organization));
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Now using the generic toJSONSafe() helper instead of listing fields by
// hand — that manual approach already missed one BigInt field once
// (organization_settings.id, separate from organization_settings.organizationId),
// which is exactly the failure mode a generic recursive converter avoids:
// it doesn't need to know your schema's field names, so there's nothing
// left to forget.
function serializeOrg(org) {
  return toJSONSafe(org);
}

module.exports = {
  getPublicOrganization,
  searchPublicOrganizations,
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganizationStatus,
  getMyOrganization,
  updateMyOrganization,
};
