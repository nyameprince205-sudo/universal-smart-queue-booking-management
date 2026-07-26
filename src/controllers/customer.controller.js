const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const prisma = require("../config/db");
const { signCustomerAccessToken, signCustomerRefreshToken, verifyRefreshToken } = require("../utils/jwt");

// ---- Customer self-service (public, then self-authenticated) ----
// Notice NONE of these functions take an organizationId anywhere — that's
// the whole point of Section 2 in this phase's explanation. A customer
// exists once, platform-wide, before they've ever interacted with a single
// organization.

async function register(req, res) {
  const { name, phone, email, password } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: "name, phone, and password are required" });
  }

  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({ error: "A customer with this phone number already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const customer = await prisma.customer.create({
    data: {
      uuid: randomUUID(),
      name,
      phone,
      email: email || null,
      passwordHash,
      status: "active",
    },
  });

  const accessToken = signCustomerAccessToken(customer);
  const refreshToken = signCustomerRefreshToken(customer);

  return res.status(201).json({
    accessToken,
    refreshToken,
    customer: serializeCustomer(customer),
  });
}

async function login(req, res) {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: "phone and password are required" });
  }

  const customer = await prisma.customer.findUnique({ where: { phone } });

  // Same deliberately-vague error as staff login (auth.controller.js) —
  // don't let a client learn whether a phone number is registered at all.
  if (!customer || customer.status !== "active" || !customer.passwordHash) {
    return res.status(401).json({ error: "Invalid phone number or password" });
  }

  const matches = await bcrypt.compare(password, customer.passwordHash);
  if (!matches) {
    return res.status(401).json({ error: "Invalid phone number or password" });
  }

  const accessToken = signCustomerAccessToken(customer);
  const refreshToken = signCustomerRefreshToken(customer);

  return res.json({ accessToken, refreshToken, customer: serializeCustomer(customer) });
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  const customer = await prisma.customer.findUnique({ where: { id: BigInt(payload.sub) } });
  if (!customer || customer.status !== "active") {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  return res.json({ accessToken: signCustomerAccessToken(customer) });
}

async function getMe(req, res) {
  const customer = await prisma.customer.findUnique({ where: { id: BigInt(req.auth.userId) } });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  return res.json(serializeCustomer(customer));
}

// A customer's relationship history spans EVERY organization they've used —
// this is the payoff of the customers/customer_organizations split made
// visible: one customer, many businesses, one query.
async function getMyOrganizationHistory(req, res) {
  const relationships = await prisma.customerOrganization.findMany({
    where: { customerId: BigInt(req.auth.userId) },
    include: { organization: { select: { name: true, slug: true } } },
  });

  return res.json(
    relationships.map((r) => ({
      organizationName: r.organization.name,
      organizationSlug: r.organization.slug,
      totalBookings: r.totalBookings,
      firstInteractionAt: r.firstInteractionAt,
      lastInteractionAt: r.lastInteractionAt,
      status: r.status,
    }))
  );
}

// ---- Staff-side (tenant-scoped): look up or quick-register a customer ----
// Used during check-in (Phase 11) when staff need a customerId to attach to
// a booking/queue ticket, and the person may or may not already exist on
// the platform (they might be a first-timer here, but a regular at a
// completely different organization).

async function lookupByPhone(req, res) {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: "phone query parameter is required" });

  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (!customer) return res.status(404).json({ error: "No customer found with that phone number" });

  return res.json(serializeCustomer(customer));
}

async function quickRegister(req, res) {
  const { name, phone, email } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "name and phone are required" });

  // Staff-assisted registration deliberately has NO password — a walk-in
  // customer isn't creating an account right now, staff are just getting
  // them a platform identity so a booking/queue ticket has someone to point
  // to. The customer can set a password later via a "claim your account"
  // flow if you build one — out of scope for this phase.
  let customer = await prisma.customer.findUnique({ where: { phone } });

  if (!customer) {
    customer = await prisma.customer.create({
      data: { uuid: randomUUID(), name, phone, email: email || null, status: "active" },
    });
  }

  // Immediately establish (or touch) this organization's relationship to
  // the customer — this is the same upsert pattern used in
  // booking.controller.js when a booking is created.
  await prisma.customerOrganization.upsert({
    where: {
      customerId_organizationId: {
        customerId: customer.id,
        organizationId: req.tenant.organizationId,
      },
    },
    update: { lastInteractionAt: new Date() },
    create: {
      customerId: customer.id,
      organizationId: req.tenant.organizationId,
      firstInteractionAt: new Date(),
      lastInteractionAt: new Date(),
      totalBookings: 0,
    },
  });

  return res.status(201).json(serializeCustomer(customer));
}

function serializeCustomer(customer) {
  return {
    id: customer.id.toString(),
    uuid: customer.uuid,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    status: customer.status,
  };
}

module.exports = {
  register,
  login,
  refresh,
  getMe,
  getMyOrganizationHistory,
  lookupByPhone,
  quickRegister,
};
