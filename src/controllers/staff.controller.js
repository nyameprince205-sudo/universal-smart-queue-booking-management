const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const prisma = require("../config/db");
const { validatePasswordStrength } = require("../utils/passwordStrength");
const { issueToken } = require("../services/authToken.service");
const { notifyInBackground } = require("../services/notification.service");
const { toJSONSafe } = require("../utils/serialize");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---- Task 3: the account-creation flow the email-verification system was
// built for but had nothing to attach to (see the big comment on
// User.emailVerified in schema.prisma — "only accounts created through a
// FUTURE invite staff endpoint would ever start out false"). This is that
// endpoint. An ORG_ADMIN creates a STAFF account for their own
// organization; unlike every existing seeded/migrated user, this one
// starts out genuinely UNVERIFIED, and — once REQUIRE_EMAIL_VERIFICATION=
// true is set — can't log in until they click the link in their
// verification email.
//
// Scope note: this covers ORG_ADMIN creating STAFF specifically, not the
// full "Super Admin creates Org Admin" case Task 3 also mentions — that
// path has a different problem (creating an Organization today doesn't
// create ANY login for it either) that's really a separate feature, not
// a small extension of this one.
async function createStaff(req, res) {
  const { name, email, password, branchId } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email, and password are required" });
  }

  const strengthError = validatePasswordStrength(password);
  if (strengthError) return res.status(400).json({ error: strengthError });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  // Same branch-ownership check pattern used everywhere else a tenant
  // supplies an ID directly (see booking.controller.js's createBookingCore,
  // report.controller.js's resolveBranchFilter) — without it, an admin
  // could scope a new staff member to a branch that isn't even theirs.
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: BigInt(branchId), organizationId: req.tenant.organizationId },
    });
    if (!branch) return res.status(400).json({ error: "branchId does not belong to this organization" });
  }

  // Looked up by NAME, not a hardcoded id — role ids come from whatever
  // order roles happened to be seeded in, which isn't something this code
  // should assume or depend on.
  const staffRole = await prisma.role.findUnique({ where: { name: "STAFF" } });
  if (!staffRole) {
    // A missing STAFF role means the platform's own seed data is broken —
    // that's a deployment/data-integrity problem, not something the
    // person submitting this form did wrong.
    throw httpError(500, "STAFF role is not configured on this platform");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      uuid: randomUUID(),
      organizationId: req.tenant.organizationId,
      branchId: branchId ? BigInt(branchId) : null,
      roleId: staffRole.id,
      name,
      email,
      passwordHash,
      status: "active",
      // Explicitly false. The migration that added this column defaulted
      // EXISTING rows to true specifically so it wouldn't lock anyone out
      // retroactively — but this is a brand new account created today,
      // through the flow that column was always meant for. It has not
      // verified anything yet.
      emailVerified: false,
    },
  });

  const rawToken = await issueToken({ type: "email_verification", ownerType: "user", ownerId: user.id });
  const verifyLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
  // Fire-and-forget, same as every other notification in this app (see
  // booking.controller.js) — a flaky email provider should never turn a
  // successful account creation into a failed API response. notify()
  // looks up the contact itself from recipientId, so there's no need to
  // pass user.email separately — it re-fetches the SAME record we just
  // created, guaranteeing the address it sends to is the one actually
  // saved, not whatever was in the request body.
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "user",
    recipientId: user.id,
    channel: "email",
    message: `Welcome! Verify your email to activate your account: ${verifyLink} (this link expires in 24 hours)`,
  });

  return res.status(201).json(
    toJSONSafe({
      id: user.id,
      name: user.name,
      email: user.email,
      role: staffRole.name,
      branchId: user.branchId,
      emailVerified: user.emailVerified,
    })
  );
}

// ---- List staff for the admin's own organization — a companion to
// createStaff. An admin who can add staff needs to be able to see who
// they've already added, including whether each one has verified their
// email yet. ----
async function listStaff(req, res) {
  const users = await prisma.user.findMany({
    where: { organizationId: req.tenant.organizationId, role: { name: "STAFF" } },
    include: { role: true, branch: true },
    orderBy: { createdAt: "desc" },
  });

  return res.json(
    users.map((u) =>
      toJSONSafe({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role.name,
        branchId: u.branchId,
        branchName: u.branch?.name || null,
        status: u.status,
        emailVerified: u.emailVerified,
        lastLoginAt: u.lastLoginAt,
      })
    )
  );
}

module.exports = { createStaff, listStaff };
