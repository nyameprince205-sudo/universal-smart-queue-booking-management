const bcrypt = require("bcryptjs");
const {
  randomUUID
} = require("crypto");
const prisma = require("../config/db");
const {
  validatePasswordStrength
} = require("../utils/passwordStrength");
const {
  issueToken
} = require("../services/authToken.service");
const {
  notifyInBackground
} = require("../services/notification.service");
const {
  logActivity
} = require("../services/auditLog.service");
const {
  toJSONSafe
} = require("../utils/serialize");
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
async function createStaff(req, res) {
  const {
    name,
    email,
    password,
    branchId
  } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({
      error: "name, email, and password are required"
    });
  }
  const strengthError = validatePasswordStrength(password);
  if (strengthError) return res.status(400).json({
    error: strengthError
  });
  const existing = await prisma.user.findUnique({
    where: {
      email
    }
  });
  if (existing) {
    return res.status(409).json({
      error: "A user with this email already exists"
    });
  }
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: {
        id: BigInt(branchId),
        organizationId: req.tenant.organizationId
      }
    });
    if (!branch) return res.status(400).json({
      error: "branchId does not belong to this organization"
    });
  }
  const staffRole = await prisma.role.findUnique({
    where: {
      name: "STAFF"
    }
  });
  if (!staffRole) {
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
      emailVerified: false
    }
  });
  const rawToken = await issueToken({
    type: "email_verification",
    ownerType: "user",
    ownerId: user.id
  });
  const verifyLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${rawToken}`;
  notifyInBackground({
    organizationId: req.tenant.organizationId,
    recipientType: "user",
    recipientId: user.id,
    channel: "email",
    message: `Welcome! Verify your email to activate your account: ${verifyLink} (this link expires in 24 hours)`
  });
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "staff_created",
    entityType: "user",
    entityId: user.id,
    metadata: {
      staffName: user.name
    }
  });
  return res.status(201).json(toJSONSafe({
    id: user.id,
    name: user.name,
    email: user.email,
    role: staffRole.name,
    branchId: user.branchId,
    emailVerified: user.emailVerified
  }));
}
async function listStaff(req, res) {
  const users = await prisma.user.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      role: {
        name: "STAFF"
      }
    },
    include: {
      role: true,
      branch: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return res.json(users.map(u => toJSONSafe({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role.name,
    branchId: u.branchId,
    branchName: u.branch?.name || null,
    status: u.status,
    emailVerified: u.emailVerified,
    lastLoginAt: u.lastLoginAt
  })));
}
async function findManageableStaff(req) {
  return prisma.user.findFirst({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId,
      role: {
        name: "STAFF"
      }
    }
  });
}
async function deactivateStaff(req, res) {
  const staff = await findManageableStaff(req);
  if (!staff) return res.status(404).json({
    error: "Staff member not found"
  });
  if (staff.status === "inactive") {
    return res.status(400).json({
      error: "This staff member is already deactivated"
    });
  }
  const updated = await prisma.user.update({
    where: {
      id: staff.id
    },
    data: {
      status: "inactive"
    }
  });
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "staff_deactivated",
    entityType: "user",
    entityId: staff.id,
    metadata: {
      staffName: staff.name
    }
  });
  return res.json(toJSONSafe({
    id: updated.id,
    name: updated.name,
    status: updated.status
  }));
}
async function reactivateStaff(req, res) {
  const staff = await findManageableStaff(req);
  if (!staff) return res.status(404).json({
    error: "Staff member not found"
  });
  if (staff.status === "active") {
    return res.status(400).json({
      error: "This staff member is already active"
    });
  }
  const updated = await prisma.user.update({
    where: {
      id: staff.id
    },
    data: {
      status: "active"
    }
  });
  logActivity({
    organizationId: req.tenant.organizationId,
    userId: req.auth?.userId ? BigInt(req.auth.userId) : null,
    action: "staff_reactivated",
    entityType: "user",
    entityId: staff.id,
    metadata: {
      staffName: staff.name
    }
  });
  return res.json(toJSONSafe({
    id: updated.id,
    name: updated.name,
    status: updated.status
  }));
}
module.exports = {
  createStaff,
  listStaff,
  deactivateStaff,
  reactivateStaff
};