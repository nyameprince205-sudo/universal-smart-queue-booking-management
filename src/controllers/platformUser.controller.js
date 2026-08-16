const prisma = require("../config/db");
const {
  toJSONSafe
} = require("../utils/serialize");
async function getOrgAdminRoleId() {
  const role = await prisma.role.findUnique({
    where: {
      name: "ORG_ADMIN"
    }
  });
  if (!role) {
    const err = new Error("ORG_ADMIN role is not configured on this platform");
    err.status = 500;
    throw err;
  }
  return role.id;
}
async function listOrgAdmins(req, res) {
  const roleId = await getOrgAdminRoleId();
  const admins = await prisma.user.findMany({
    where: {
      roleId
    },
    include: {
      organization: {
        select: {
          name: true,
          slug: true,
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  return res.json(toJSONSafe(admins.map(a => ({
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    status: a.status,
    organizationName: a.organization?.name || null,
    organizationSlug: a.organization?.slug || null,
    organizationStatus: a.organization?.status || null,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt
  }))));
}
async function findManageableOrgAdmin(req) {
  const roleId = await getOrgAdminRoleId();
  return prisma.user.findFirst({
    where: {
      id: BigInt(req.params.id),
      roleId
    }
  });
}
async function deactivateOrgAdmin(req, res) {
  const admin = await findManageableOrgAdmin(req);
  if (!admin) return res.status(404).json({
    error: "Org Admin not found"
  });
  if (admin.status === "inactive") {
    return res.status(400).json({
      error: "This Org Admin is already deactivated"
    });
  }
  const updated = await prisma.user.update({
    where: {
      id: admin.id
    },
    data: {
      status: "inactive"
    }
  });
  return res.json(toJSONSafe({
    id: updated.id,
    name: updated.name,
    status: updated.status
  }));
}
async function reactivateOrgAdmin(req, res) {
  const admin = await findManageableOrgAdmin(req);
  if (!admin) return res.status(404).json({
    error: "Org Admin not found"
  });
  if (admin.status === "active") {
    return res.status(400).json({
      error: "This Org Admin is already active"
    });
  }
  const updated = await prisma.user.update({
    where: {
      id: admin.id
    },
    data: {
      status: "active"
    }
  });
  return res.json(toJSONSafe({
    id: updated.id,
    name: updated.name,
    status: updated.status
  }));
}
module.exports = {
  listOrgAdmins,
  deactivateOrgAdmin,
  reactivateOrgAdmin
};