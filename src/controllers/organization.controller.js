const prisma = require("../config/db");
const {
  randomUUID,
  randomBytes
} = require("crypto");
const bcrypt = require("bcryptjs");
const {
  toJSONSafe
} = require("../utils/serialize");
const {
  issueToken
} = require("../services/authToken.service");
const {
  notifyInBackground
} = require("../services/notification.service");
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
async function getPublicOrganization(req, res) {
  const organization = await prisma.organization.findUnique({
    where: {
      slug: req.params.slug
    },
    include: {
      branches: {
        where: {
          status: "active"
        }
      },
      services: {
        where: {
          isActive: true
        }
      }
    }
  });
  if (!organization || organization.status === "cancelled") {
    return res.status(404).json({
      error: "Organization not found"
    });
  }
  return res.json(toJSONSafe({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logoUrl: organization.logoUrl,
    phone: organization.phone,
    description: organization.description,
    whatsapp: organization.whatsapp,
    website: organization.website,
    facebook: organization.facebook,
    instagram: organization.instagram,
    openingHours: organization.openingHours,
    branches: organization.branches,
    services: organization.services
  }));
}
async function searchPublicOrganizations(req, res) {
  const search = req.query.search?.trim();
  const organizations = await prisma.organization.findMany({
    where: {
      status: {
        not: "cancelled"
      },
      ...(search ? {
        name: {
          contains: search
        }
      } : {})
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      businessType: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });
  return res.json(toJSONSafe(organizations));
}
async function createOrganizationCore({
  name,
  email,
  businessTypeId,
  phone,
  logoUrl,
  ownerName
}) {
  const slug = slugify(name);
  const orgAdminRole = await prisma.role.findUnique({
    where: {
      name: "ORG_ADMIN"
    }
  });
  if (!orgAdminRole) {
    throw httpError(500, "ORG_ADMIN role is not configured on this platform");
  }
  const {
    org,
    adminUser
  } = await prisma.$transaction(async tx => {
    const org = await tx.organization.create({
      data: {
        uuid: randomUUID(),
        businessTypeId: Number(businessTypeId),
        name,
        slug,
        email,
        phone: phone || null,
        logoUrl: logoUrl || null,
        status: "trial"
      }
    });
    await tx.organizationSettings.create({
      data: {
        organizationId: org.id,
        queuePrefix: name.trim().charAt(0).toUpperCase() || "Q",
        timezone: "Africa/Accra"
      }
    });
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
        emailVerified: true
      }
    });
    return {
      org,
      adminUser
    };
  });
  const rawToken = await issueToken({
    type: "password_reset",
    ownerType: "user",
    ownerId: adminUser.id
  });
  const setPasswordLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
  const message = `Welcome to the platform! ${name} is ready to go. Set your password to log in as its Org Admin: ${setPasswordLink} (this link expires in 30 minutes)`;
  notifyInBackground({
    organizationId: org.id,
    recipientType: "user",
    recipientId: adminUser.id,
    channel: "email",
    message
  });
  if (phone) {
    notifyInBackground({
      organizationId: org.id,
      recipientType: "user",
      recipientId: adminUser.id,
      channel: "sms",
      message
    });
  }
  return org;
}
async function createOrganization(req, res) {
  const {
    name,
    email,
    businessTypeId,
    phone,
    logoUrl
  } = req.body;
  if (!name || !email || !businessTypeId) {
    return res.status(400).json({
      error: "name, email, and businessTypeId are required"
    });
  }
  const organization = await createOrganizationCore({
    name,
    email,
    businessTypeId,
    phone,
    logoUrl
  });
  return res.status(201).json(serializeOrg(organization));
}
async function listOrganizations(req, res) {
  const organizations = await prisma.organization.findMany({
    orderBy: {
      createdAt: "desc"
    },
    include: {
      businessType: true
    }
  });
  return res.json(organizations.map(serializeOrg));
}
async function getOrganization(req, res) {
  const organization = await prisma.organization.findUnique({
    where: {
      id: BigInt(req.params.id)
    },
    include: {
      businessType: true,
      settings: true
    }
  });
  if (!organization) return res.status(404).json({
    error: "Organization not found"
  });
  return res.json(serializeOrg(organization));
}
async function updateOrganizationStatus(req, res) {
  const {
    status
  } = req.body;
  const allowed = ["trial", "active", "suspended", "cancelled"];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowed.join(", ")}`
    });
  }
  const organization = await prisma.organization.update({
    where: {
      id: BigInt(req.params.id)
    },
    data: {
      status
    }
  });
  return res.json(serializeOrg(organization));
}
async function getMyOrganization(req, res) {
  const organization = await prisma.organization.findUnique({
    where: {
      id: req.tenant.organizationId
    },
    include: {
      businessType: true,
      settings: true
    }
  });
  if (!organization) return res.status(404).json({
    error: "Organization not found"
  });
  return res.json(serializeOrg(organization));
}
async function updateMyOrganization(req, res) {
  const {
    name,
    phone,
    logoUrl,
    queuePrefix,
    timezone,
    description,
    whatsapp,
    website,
    facebook,
    instagram,
    openingHours
  } = req.body;
  const organization = await prisma.organization.update({
    where: {
      id: req.tenant.organizationId
    },
    data: {
      name: name || undefined,
      phone: phone || undefined,
      logoUrl: logoUrl || undefined,
      description: description || undefined,
      whatsapp: whatsapp || undefined,
      website: website || undefined,
      facebook: facebook || undefined,
      instagram: instagram || undefined,
      openingHours: openingHours || undefined
    }
  });
  if (queuePrefix || timezone) {
    await prisma.organizationSettings.update({
      where: {
        organizationId: req.tenant.organizationId
      },
      data: {
        queuePrefix: queuePrefix || undefined,
        timezone: timezone || undefined
      }
    });
  }
  return res.json(serializeOrg(organization));
}
function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
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
  updateMyOrganization
};