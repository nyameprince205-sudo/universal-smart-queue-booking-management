const prisma = require("../config/db");

// Business types are fixed reference data (Restaurant, Salon, Clinic, etc.
// — see prisma/seed.sql) with no per-tenant data attached, so this is
// SUPER_ADMIN-only for now simply because the only place that needs it
// right now is the "create organization" form. If a later feature needs
// this list publicly (e.g. an org signup flow), that's a one-line change
// to the route, not the controller.
async function listBusinessTypes(req, res) {
  const businessTypes = await prisma.businessType.findMany({ orderBy: { name: "asc" } });
  return res.json(businessTypes);
}

module.exports = { listBusinessTypes };
