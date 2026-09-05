const prisma = require("../config/db");
async function serviceIdsForStaff(userId) {
  const rows = await prisma.staffService.findMany({
    where: {
      userId
    },
    select: {
      serviceId: true
    }
  });
  return rows.length > 0 ? rows.map(r => r.serviceId) : null;
}
async function getStaffServices(req, res) {
  const staffId = BigInt(req.params.id);
  const staff = await prisma.user.findFirst({
    where: {
      id: staffId,
      organizationId: req.tenant.organizationId
    },
    select: {
      id: true,
      name: true
    }
  });
  if (!staff) return res.status(404).json({
    error: "Staff member not found"
  });
  const rows = await prisma.staffService.findMany({
    where: {
      userId: staffId
    },
    select: {
      serviceId: true,
      service: {
        select: {
          name: true
        }
      }
    }
  });
  return res.json({
    staffId: staffId.toString(),
    staffName: staff.name,
    serviceIds: rows.map(r => r.serviceId.toString()),
    services: rows.map(r => ({
      id: r.serviceId.toString(),
      name: r.service?.name
    })),
    handlesAllServices: rows.length === 0
  });
}
async function setStaffServices(req, res) {
  const staffId = BigInt(req.params.id);
  const {
    serviceIds
  } = req.body;
  if (!Array.isArray(serviceIds)) {
    return res.status(400).json({
      error: "serviceIds must be an array"
    });
  }
  const staff = await prisma.user.findFirst({
    where: {
      id: staffId,
      organizationId: req.tenant.organizationId
    },
    select: {
      id: true
    }
  });
  if (!staff) return res.status(404).json({
    error: "Staff member not found"
  });
  const ids = serviceIds.map(s => BigInt(s));
  if (ids.length > 0) {
    const owned = await prisma.service.findMany({
      where: {
        id: {
          in: ids
        },
        organizationId: req.tenant.organizationId
      },
      select: {
        id: true
      }
    });
    if (owned.length !== ids.length) {
      return res.status(400).json({
        error: "One or more services do not belong to this organization"
      });
    }
  }
  await prisma.$transaction(async tx => {
    await tx.staffService.deleteMany({
      where: {
        userId: staffId
      }
    });
    if (ids.length > 0) {
      await tx.staffService.createMany({
        data: ids.map(serviceId => ({
          userId: staffId,
          serviceId
        }))
      });
    }
  });
  return res.json({
    staffId: staffId.toString(),
    serviceIds: ids.map(i => i.toString()),
    handlesAllServices: ids.length === 0
  });
}
async function getMyServices(req, res) {
  const userId = BigInt(req.auth.userId);
  const ids = await serviceIdsForStaff(userId);
  return res.json({
    serviceIds: ids ? ids.map(i => i.toString()) : [],
    handlesAllServices: ids === null
  });
}
module.exports = {
  getStaffServices,
  setStaffServices,
  getMyServices,
  serviceIdsForStaff
};