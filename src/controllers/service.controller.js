const prisma = require("../config/db");

// Notice this file is almost a copy of branch.controller.js. That repetition
// is intentional at this stage — once you've built 3-4 of these and the
// pattern is second nature, THEN it's worth extracting a generic
// "tenant-scoped repository" helper. Abstracting too early, before you've
// felt the repetition yourself, tends to produce the wrong abstraction.

async function listServices(req, res) {
  const services = await prisma.service.findMany({
    where: { organizationId: req.tenant.organizationId, isActive: true },
    orderBy: { name: "asc" },
  });
  return res.json(services.map(serialize));
}

async function createService(req, res) {
  const { name, description, durationMinutes, price, branchId } = req.body;

  if (!name) return res.status(400).json({ error: "name is required" });

  const service = await prisma.service.create({
    data: {
      organizationId: req.tenant.organizationId,
      branchId: branchId ? BigInt(branchId) : null,
      name,
      description,
      durationMinutes: durationMinutes || 30,
      price: price ?? null,
    },
  });

  return res.status(201).json(serialize(service));
}

async function deactivateService(req, res) {
  const result = await prisma.service.updateMany({
    where: { id: BigInt(req.params.id), organizationId: req.tenant.organizationId },
    data: { isActive: false },
  });

  if (result.count === 0) return res.status(404).json({ error: "Service not found" });
  return res.status(204).send();
}

function serialize(service) {
  return {
    ...service,
    id: service.id.toString(),
    organizationId: service.organizationId.toString(),
    branchId: service.branchId ? service.branchId.toString() : null,
    price: service.price ? service.price.toString() : null,
  };
}

module.exports = { listServices, createService, deactivateService };
