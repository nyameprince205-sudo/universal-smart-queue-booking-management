const prisma = require("../config/db");
const { toJSONSafe } = require("../utils/serialize");

// ---- Public (no auth): submit a request to join the platform ----
// This exists BEFORE any organization/login is created for the requester —
// there's nothing to authenticate against yet, same reasoning as guest
// booking (Task 4) having no auth requirement.
async function submitOrganizationRequest(req, res) {
  const {
    businessName,
    ownerName,
    businessType,
    phone,
    email,
    address,
    city,
    region,
    numberOfBranches,
    additionalNotes,
  } = req.body;

  if (!businessName || !ownerName || !businessType || !phone || !email) {
    return res.status(400).json({
      error: "businessName, ownerName, businessType, phone, and email are required",
    });
  }

  const request = await prisma.organizationRequest.create({
    data: {
      businessName,
      ownerName,
      businessType,
      phone,
      email,
      address: address || null,
      city: city || null,
      region: region || null,
      numberOfBranches: numberOfBranches ? Number(numberOfBranches) : null,
      additionalNotes: additionalNotes || null,
      status: "pending",
    },
  });

  return res.status(201).json(toJSONSafe({ id: request.id, status: request.status }));
}

// ---- Super Admin: list requests, optionally filtered by status ----
async function listOrganizationRequests(req, res) {
  const { status } = req.query;
  const allowedStatuses = ["pending", "approved", "rejected"];

  const requests = await prisma.organizationRequest.findMany({
    where: status && allowedStatuses.includes(status) ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: { reviewer: { select: { name: true } } },
  });

  return res.json(toJSONSafe(requests));
}

// ---- Super Admin: approve or reject a request ----
// Deliberately does NOT create the Organization itself — see the delivery
// notes for why. This just records the review decision; actually
// provisioning an approved business still goes through the existing
// "Create Organization" flow on the Platform page, same as any other org
// creation, so there's exactly ONE code path that ever creates an
// Organization row rather than two that could drift apart.
async function reviewOrganizationRequest(req, res) {
  const { status, reviewNotes } = req.body;
  const allowedStatuses = ["approved", "rejected"];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(", ")}` });
  }

  const existing = await prisma.organizationRequest.findUnique({ where: { id: BigInt(req.params.id) } });
  if (!existing) return res.status(404).json({ error: "Request not found" });
  if (existing.status !== "pending") {
    return res.status(400).json({ error: `This request was already ${existing.status}` });
  }

  const updated = await prisma.organizationRequest.update({
    where: { id: existing.id },
    data: {
      status,
      reviewNotes: reviewNotes || null,
      reviewedAt: new Date(),
      reviewedBy: BigInt(req.auth.userId),
    },
  });

  return res.json(toJSONSafe(updated));
}

module.exports = { submitOrganizationRequest, listOrganizationRequests, reviewOrganizationRequest };
