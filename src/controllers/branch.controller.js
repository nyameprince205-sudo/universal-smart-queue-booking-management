const prisma = require("../config/db");

// Every function here follows the same shape: take req.tenant.organizationId
// (set by tenant.middleware.js, NEVER from req.body/req.params) and thread it
// into every Prisma call — both to filter reads and to stamp writes. This is
// the pattern you'll copy for services, bookings, queue tickets, everything.

async function listBranches(req, res) {
  const branches = await prisma.branch.findMany({
    where: { organizationId: req.tenant.organizationId },
    orderBy: { createdAt: "asc" },
  });
  return res.json(serializeMany(branches));
}

async function getBranch(req, res) {
  const branch = await prisma.branch.findFirst({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId, // <- the guard against IDOR:
      // even though `id` is a global auto-increment, findFirst only returns
      // a row if it ALSO belongs to this organization. Guessing another
      // org's branch id returns 404, not someone else's data.
    },
  });

  if (!branch) return res.status(404).json({ error: "Branch not found" });
  return res.json(serialize(branch));
}

async function createBranch(req, res) {
  const { name, address, phone, timezone } = req.body;

  if (!name) return res.status(400).json({ error: "name is required" });

  const branch = await prisma.branch.create({
    data: {
      organizationId: req.tenant.organizationId,
      name,
      address,
      phone,
      timezone,
    },
  });

  return res.status(201).json(serialize(branch));
}

async function updateBranch(req, res) {
  const { name, address, phone, timezone, status } = req.body;

  // updateMany (not update) is the trick here: update() would need a bare
  // `where: { id }` and throw if the row belongs to another org. updateMany
  // lets us combine id + organizationId in one filter, so a mismatched
  // tenant simply updates zero rows instead of ever touching foreign data.
  const result = await prisma.branch.updateMany({
    where: {
      id: BigInt(req.params.id),
      organizationId: req.tenant.organizationId,
    },
    data: { name, address, phone, timezone, status },
  });

  if (result.count === 0) {
    return res.status(404).json({ error: "Branch not found" });
  }

  const updated = await prisma.branch.findUnique({ where: { id: BigInt(req.params.id) } });
  return res.json(serialize(updated));
}

function serialize(branch) {
  return { ...branch, id: branch.id.toString(), organizationId: branch.organizationId.toString() };
}

function serializeMany(branches) {
  return branches.map(serialize);
}

module.exports = { listBranches, getBranch, createBranch, updateBranch };
