const prisma = require("../config/db");
async function listBranches(req, res) {
  const branches = await prisma.branch.findMany({
    where: {
      organizationId: req.tenant.organizationId
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return res.json(serializeMany(branches));
}
async function getBranch(req, res) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId
    }
  });
  if (!branch) return res.status(404).json({
    error: "Branch not found"
  });
  return res.json(serialize(branch));
}
async function createBranch(req, res) {
  const {
    name,
    address,
    phone,
    timezone
  } = req.body;
  if (!name) return res.status(400).json({
    error: "name is required"
  });
  const branch = await prisma.branch.create({
    data: {
      organizationId: req.tenant.organizationId,
      name,
      address,
      phone,
      timezone
    }
  });
  return res.status(201).json(serialize(branch));
}
async function updateBranch(req, res) {
  const {
    name,
    address,
    phone,
    timezone,
    status
  } = req.body;
  const result = await prisma.branch.updateMany({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId
    },
    data: {
      name,
      address,
      phone,
      timezone,
      status
    }
  });
  if (result.count === 0) {
    return res.status(404).json({
      error: "Branch not found"
    });
  }
  const updated = await prisma.branch.findUnique({
    where: {
      id: BigInt(req.params.id)
    }
  });
  return res.json(serialize(updated));
}
function serialize(branch) {
  return {
    ...branch,
    id: branch.id.toString(),
    organizationId: branch.organizationId.toString()
  };
}
function serializeMany(branches) {
  return branches.map(serialize);
}
module.exports = {
  listBranches,
  getBranch,
  createBranch,
  updateBranch
};