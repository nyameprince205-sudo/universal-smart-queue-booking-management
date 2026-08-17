const bcrypt = require("bcryptjs");
const {
  randomUUID
} = require("crypto");
const prisma = require("../config/db");
const {
  signCustomerAccessToken,
  signCustomerRefreshToken,
  verifyRefreshToken
} = require("../utils/jwt");
const {
  issueToken
} = require("../services/authToken.service");
const {
  sendEmail,
  sendSms
} = require("../services/notification.service");
async function register(req, res) {
  const {
    name,
    phone,
    email,
    password
  } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({
      error: "name, phone, and password are required"
    });
  }
  const existing = await prisma.customer.findUnique({
    where: {
      phone
    }
  });
  if (existing) {
    return res.status(409).json({
      error: "A customer with this phone number already exists"
    });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const customer = await prisma.customer.create({
    data: {
      uuid: randomUUID(),
      name,
      phone,
      email: email || null,
      passwordHash,
      status: "active"
    }
  });
  const accessToken = signCustomerAccessToken(customer);
  const refreshToken = signCustomerRefreshToken(customer);
  return res.status(201).json({
    accessToken,
    refreshToken,
    customer: serializeCustomer(customer)
  });
}
async function login(req, res) {
  const {
    phone,
    password
  } = req.body;
  if (!phone || !password) {
    return res.status(400).json({
      error: "phone and password are required"
    });
  }
  const customer = await prisma.customer.findUnique({
    where: {
      phone
    }
  });
  if (!customer || customer.status !== "active" || !customer.passwordHash) {
    return res.status(401).json({
      error: "Invalid phone number or password"
    });
  }
  const matches = await bcrypt.compare(password, customer.passwordHash);
  if (!matches) {
    return res.status(401).json({
      error: "Invalid phone number or password"
    });
  }
  const accessToken = signCustomerAccessToken(customer);
  const refreshToken = signCustomerRefreshToken(customer);
  return res.json({
    accessToken,
    refreshToken,
    customer: serializeCustomer(customer)
  });
}
async function refresh(req, res) {
  const {
    refreshToken
  } = req.body;
  if (!refreshToken) return res.status(400).json({
    error: "refreshToken is required"
  });
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired refresh token"
    });
  }
  const customer = await prisma.customer.findUnique({
    where: {
      id: BigInt(payload.sub)
    }
  });
  if (!customer || customer.status !== "active") {
    return res.status(401).json({
      error: "Invalid or expired refresh token"
    });
  }
  if (customer.passwordChangedAt && payload.iat * 1000 < customer.passwordChangedAt.getTime()) {
    return res.status(401).json({
      error: "Your password was changed. Please log in again."
    });
  }
  return res.json({
    accessToken: signCustomerAccessToken(customer)
  });
}
async function getMe(req, res) {
  const customer = await prisma.customer.findUnique({
    where: {
      id: BigInt(req.auth.userId)
    }
  });
  if (!customer) return res.status(404).json({
    error: "Customer not found"
  });
  return res.json(serializeCustomer(customer));
}
async function getMyOrganizationHistory(req, res) {
  const relationships = await prisma.customerOrganization.findMany({
    where: {
      customerId: BigInt(req.auth.userId)
    },
    include: {
      organization: {
        select: {
          name: true,
          slug: true
        }
      }
    }
  });
  return res.json(relationships.map(r => ({
    organizationName: r.organization.name,
    organizationSlug: r.organization.slug,
    totalBookings: r.totalBookings,
    firstInteractionAt: r.firstInteractionAt,
    lastInteractionAt: r.lastInteractionAt,
    status: r.status
  })));
}
async function listMyCustomers(req, res) {
  const relationships = await prisma.customerOrganization.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          passwordHash: true
        }
      }
    },
    orderBy: {
      lastInteractionAt: "desc"
    }
  });
  return res.json(relationships.map(r => ({
    customerId: r.customer.id.toString(),
    name: r.customer.name,
    phone: r.customer.phone,
    email: r.customer.email,
    hasAccount: !!r.customer.passwordHash,
    totalBookings: r.totalBookings,
    firstInteractionAt: r.firstInteractionAt,
    lastInteractionAt: r.lastInteractionAt,
    relationshipStatus: r.status
  })));
}
async function lookupByPhone(req, res) {
  const {
    phone
  } = req.query;
  if (!phone) return res.status(400).json({
    error: "phone query parameter is required"
  });
  const customer = await prisma.customer.findUnique({
    where: {
      phone
    }
  });
  if (!customer) return res.status(404).json({
    error: "No customer found with that phone number"
  });
  return res.json(serializeCustomer(customer));
}
async function quickRegister(req, res) {
  const {
    name,
    phone,
    email
  } = req.body;
  if (!name || !phone) return res.status(400).json({
    error: "name and phone are required"
  });
  let customer = await prisma.customer.findUnique({
    where: {
      phone
    }
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        uuid: randomUUID(),
        name,
        phone,
        email: email || null,
        status: "active"
      }
    });
  }
  await prisma.customerOrganization.upsert({
    where: {
      uq_customer_org: {
        customerId: customer.id,
        organizationId: req.tenant.organizationId
      }
    },
    update: {
      lastInteractionAt: new Date()
    },
    create: {
      customerId: customer.id,
      organizationId: req.tenant.organizationId,
      firstInteractionAt: new Date(),
      lastInteractionAt: new Date(),
      totalBookings: 0
    }
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
    status: customer.status
  };
}
async function forgotPassword(req, res) {
  const {
    phone
  } = req.body;
  if (!phone) return res.status(400).json({
    error: "phone is required"
  });
  const customer = await prisma.customer.findUnique({
    where: {
      phone
    }
  });
  if (customer && customer.status === "active" && customer.passwordHash) {
    const rawToken = await issueToken({
      type: "password_reset",
      ownerType: "customer",
      ownerId: customer.id
    });
    const resetLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
    const message = `Reset your password: ${resetLink} (this link expires in 30 minutes)`;
    if (customer.email) {
      await sendEmail(customer.email, message);
    }
    await sendSms(customer.phone, message);
  }
  return res.json({
    message: "If an account exists with that phone number, a password reset link has been sent."
  });
}
module.exports = {
  register,
  login,
  refresh,
  getMe,
  getMyOrganizationHistory,
  listMyCustomers,
  lookupByPhone,
  quickRegister,
  forgotPassword
};