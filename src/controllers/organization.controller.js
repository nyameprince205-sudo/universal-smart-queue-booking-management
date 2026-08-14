const prisma = require("../config/db");
const { randomUUID, randomBytes } = require("crypto");
const bcrypt = require("bcryptjs");
const { toJSONSafe } = require("../utils/serialize");
const { issueToken } = require("../services/authToken.service");
const { notifyInBackground } = require("../services/notification.service");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

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
      phone: organization.phone,
      // Phase 17, Step 3: everything below is new — added to whatever
      // "public storefront" set of fields getPublicOrganization already
      // decided was safe to expose (see the big comment above this
      // function). Still nothing sensitive: no email, no internal settings.
      description: organization.description,
      whatsapp: organization.whatsapp,
      website: organization.website,
      facebook: organization.facebook,
      instagram: organization.instagram,
      openingHours: organization.openingHours,
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

// Extracted so this exact logic can be reused from a SECOND place —
// organizationRequest.controller.js's approval flow — without duplicating
// it. Two separate implementations of "create an organization" would
// eventually drift apart (one gets a bugfix, the other doesn't); one
// function called from two entry points can't.
//
// Real gap, found after the fact: this used to only ever create the
// Organization + its settings row — never a login for anyone to actually
// manage it. Every organization created this way, through EITHER entry
// point, came out the other end completely unusable — nobody could sign
// in as its Org Admin to add branches, staff, or anything else. Now it
// also provisions that first login, same idea as createStaff() creating
// a new staff account — except there's no existing Org Admin here to
// type a password on this person's behalf (that's the whole problem this
// function exists to solve), so instead of a caller-supplied password,
// this generates a random, unguessable placeholder that nobody is ever
// told, and immediately issues a real password-reset token so the new
// Org Admin sets their OWN first password through the same secure,
// already-tested flow "Forgot Password" uses.
async function createOrganizationCore({ name, email, businessTypeId, phone, logoUrl, ownerName }) {
  const slug = slugify(name);

  const orgAdminRole = await prisma.role.findUnique({ where: { name: "ORG_ADMIN" } });
  if (!orgAdminRole) {
    // A missing ORG_ADMIN role means the platform's own seed data is
    // broken — a deployment/data-integrity problem, not something the
    // caller (Super Admin, or an approved request) did wrong.
    throw httpError(500, "ORG_ADMIN role is not configured on this platform");
  }

  // Creating the organization, its settings row, AND its first admin user
  // together, in one transaction — an organization that exists but has
  // no admin login would be just as broken as one missing its settings
  // row, so this guarantees you never end up with either.
  const { org, adminUser } = await prisma.$transaction(async (tx) => {
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

    // Random, unguessable, and never told to anyone — this hash exists
    // only to satisfy the column's NOT NULL constraint until the real
    // owner sets their own password via the reset link below.
    const placeholderPassword = randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(placeholderPassword, 12);

    const adminUser = await tx.user.create({
      data: {
        uuid: randomUUID(),
        organizationId: org.id,
        branchId: null,
        roleId: orgAdminRole.id,
        name: ownerName || name,
        email,
        phone: phone || null,
        passwordHash,
        status: "active",
        // true, not false — unlike createStaff()'s brand-new accounts,
        // getting to this point already required either a Super Admin
        // manually creating this organization, or a registration request
        // that a Super Admin reviewed and approved. Requiring a SEPARATE
        // email-verification round trip on top of that would just be
        // friction for no real safety gain here.
        emailVerified: true,
      },
    });

    return { org, adminUser };
  });

  // Fire-and-forget, same reasoning as every other notification in this
  // app — org creation already succeeded by the time this runs; a flaky
  // email provider should never turn that into a failed API response.
  const rawToken = await issueToken({ type: "password_reset", ownerType: "user", ownerId: adminUser.id });
  const setPasswordLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
  // Sent on BOTH channels, not just one — email had gone unconfirmed for
  // a while during testing, and a new Org Admin with no way to log in at
  // all is a real problem, not just an inconvenience. WhatsApp stays out
  // of this: it's still a stub in this codebase (never wired to a real
  // provider — see notification.service.js's sendWhatsapp), so claiming
  // it as a working channel here would just be a second silent failure
  // instead of one.
  const message = `Welcome to the platform! ${name} is ready to go. Set your password to log in as its Org Admin: ${setPasswordLink} (this link expires in 30 minutes)`;

  notifyInBackground({
    organizationId: org.id,
    recipientType: "user",
    recipientId: adminUser.id,
    channel: "email",
    message,
  });

  if (phone) {
    notifyInBackground({
      organizationId: org.id,
      recipientType: "user",
      recipientId: adminUser.id,
      channel: "sms",
      message,
    });
  }

  return org;
}

async function createOrganization(req, res) {
  const { name, email, businessTypeId, phone, logoUrl } = req.body;

  if (!name || !email || !businessTypeId) {
    return res.status(400).json({ error: "name, email, and businessTypeId are required" });
  }

  const organization = await createOrganizationCore({ name, email, businessTypeId, phone, logoUrl });
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
  const { name, phone, logoUrl, queuePrefix, timezone, description, whatsapp, website, facebook, instagram, openingHours } = req.body;

  const organization = await prisma.organization.update({
    where: { id: req.tenant.organizationId },
    data: {
      name: name || undefined,
      phone: phone || undefined,
      logoUrl: logoUrl || undefined,
      // Phase 17, Step 3 — same "empty string means don't touch it" pattern
      // as the fields above, kept consistent rather than introducing a
      // different clearing behavior for only the new fields.
      description: description || undefined,
      whatsapp: whatsapp || undefined,
      website: website || undefined,
      facebook: facebook || undefined,
      instagram: instagram || undefined,
      openingHours: openingHours || undefined,
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
  createOrganizationCore,
  listOrganizations,
  getOrganization,
  updateOrganizationStatus,
  getMyOrganization,
  updateMyOrganization,
};
