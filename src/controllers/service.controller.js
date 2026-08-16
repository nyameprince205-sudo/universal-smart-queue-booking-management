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
    branchId
  } = req.body;
  if (!name) return res.status(400).json({
    error: "name is required"
  });
  const service = await prisma.service.create({
    data: {
      organizationId: req.tenant.organizationId,
      branchId: branchId ? BigInt(branchId) : null,
      name,
      description,
      durationMinutes: durationMinutes || 30,
      price: price ?? null
    }
  });
  return res.status(201).json(serialize(service));
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
  deactivateService
};