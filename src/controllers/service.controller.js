const prisma = require("../config/db");
async function listServices(req, res) {
  const services = await prisma.service.findMany({
    where: {
      organizationId: req.tenant.organizationId,
      isActive: true
    },
    orderBy: {
      name: "asc"
    }
  });
  return res.json(services.map(serialize));
}
async function createService(req, res) {
  const {
    name,
    description,
    durationMinutes,
    price,
    branchId,
    capacityPerSlot,
    whenFull
  } = req.body;
  if (!name) return res.status(400).json({
    error: "name is required"
  });
  let capacity = null;
  if (capacityPerSlot !== undefined && capacityPerSlot !== null && capacityPerSlot !== "") {
    capacity = Number(capacityPerSlot);
    if (!Number.isInteger(capacity) || capacity < 1) {
      return res.status(400).json({
        error: "capacityPerSlot must be a whole number of 1 or more, or left blank for unlimited"
      });
    }
  }
  const behaviour = whenFull === "reject" ? "reject" : "waitlist";
  const service = await prisma.service.create({
    data: {
      organizationId: req.tenant.organizationId,
      branchId: branchId ? BigInt(branchId) : null,
      name,
      description,
      durationMinutes: durationMinutes || 30,
      price: price ?? null,
      capacityPerSlot: capacity,
      whenFull: behaviour
    }
  });
  return res.status(201).json(serialize(service));
}
async function updateService(req, res) {
  const {
    name,
    description,
    durationMinutes,
    price,
    branchId,
    capacityPerSlot,
    whenFull
  } = req.body;
  const data = {};
  if (name !== undefined) {
    if (!name) return res.status(400).json({
      error: "name cannot be empty"
    });
    data.name = name;
  }
  if (description !== undefined) data.description = description || null;
  if (durationMinutes !== undefined) data.durationMinutes = Number(durationMinutes) || 30;
  if (price !== undefined) data.price = price === "" || price === null ? null : price;
  if (branchId !== undefined) data.branchId = branchId ? BigInt(branchId) : null;
  if (capacityPerSlot !== undefined) {
    if (capacityPerSlot === null || capacityPerSlot === "") {
      data.capacityPerSlot = null;
    } else {
      const capacity = Number(capacityPerSlot);
      if (!Number.isInteger(capacity) || capacity < 1) {
        return res.status(400).json({
          error: "capacityPerSlot must be a whole number of 1 or more, or left blank for unlimited"
        });
      }
      data.capacityPerSlot = capacity;
    }
  }
  if (whenFull !== undefined) {
    data.whenFull = whenFull === "reject" ? "reject" : "waitlist";
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({
      error: "No fields to update"
    });
  }
  const result = await prisma.service.updateMany({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId
    },
    data
  });
  if (result.count === 0) return res.status(404).json({
    error: "Service not found"
  });
  const updated = await prisma.service.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  return res.json(serialize(updated));
}
async function deactivateService(req, res) {
  const result = await prisma.service.updateMany({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId
    },
    data: {
      isActive: false
    }
  });
  if (result.count === 0) return res.status(404).json({
    error: "Service not found"
  });
  return res.status(204).send();
}
function serialize(service) {
  return {
    ...service,
    id: service.id.toString(),
    organizationId: service.organizationId.toString(),
    branchId: service.branchId ? service.branchId.toString() : null,
    price: service.price ? service.price.toString() : null
  };
}
module.exports = {
  listServices,
  createService,
  updateService,
  deactivateService
};