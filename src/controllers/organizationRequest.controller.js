const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
const {
  createOrganizationCore
} = require("./organization.controller");
const {
  sendEmail
} = require("../services/notification.service");
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
    additionalNotes
  } = req.body;
  if (!businessName || !ownerName || !businessType || !phone || !email) {
    return res.status(400).json({
      error: "businessName, ownerName, businessType, phone, and email are required"
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
      status: "pending"
    }
  });
  return res.status(201).json(toJSONSafe({
    id: request.id,
    status: request.status
  }));
}
async function listOrganizationRequests(req, res) {
  const {
    status
  } = req.query;
  const allowedStatuses = ["pending", "approved", "rejected"];
  const requests = await prisma.organizationRequest.findMany({
    where: status && allowedStatuses.includes(status) ? {
      status
    } : {},
    orderBy: {
      createdAt: "desc"
    },
    include: {
      reviewer: {
        select: {
          name: true
        }
      }
    }
  });
  return res.json(toJSONSafe(requests));
}
async function reviewOrganizationRequest(req, res) {
  const {
    status,
    reviewNotes,
    businessTypeId
  } = req.body;
  const allowedStatuses = ["approved", "rejected"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowedStatuses.join(", ")}`
    });
  }
  if (status === "approved" && !businessTypeId) {
    return res.status(400).json({
      error: "businessTypeId is required to approve a request"
    });
  }
  const existing = await prisma.organizationRequest.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  if (!existing) return res.status(404).json({
    error: "Request not found"
  });
  if (existing.status !== "pending") {
    return res.status(400).json({
      error: `This request was already ${existing.status}`
    });
  }
  let createdOrganizationId = null;
  if (status === "approved") {
    const organization = await createOrganizationCore({
      name: existing.businessName,
      email: existing.email,
      phone: existing.phone,
      businessTypeId,
      ownerName: existing.ownerName
    });
    createdOrganizationId = organization.id;
  }
  const updated = await prisma.organizationRequest.update({
    where: {
      id: existing.id
    },
    data: {
      status,
      reviewNotes: reviewNotes || null,
      reviewedAt: new Date(),
      reviewedBy: BigInt(req.auth.userId),
      createdOrganizationId
    }
  });
  if (status === "approved") {
    sendEmail(existing.email, `Good news — ${existing.businessName} has been approved and is now live on the platform. You can reach out to your account contact for next steps on getting your team set up.`).catch(() => {});
  } else {
    sendEmail(existing.email, `Thanks for your interest in joining the platform. After review, we're not able to move forward with ${existing.businessName}'s registration at this time.${reviewNotes ? ` Note: ${reviewNotes}` : ""}`).catch(() => {});
  }
  return res.json(toJSONSafe(updated));
}
module.exports = {
  submitOrganizationRequest,
  listOrganizationRequests,
  reviewOrganizationRequest
};