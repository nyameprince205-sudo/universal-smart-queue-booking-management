const prisma = require("../config/db");
async function listBusinessTypes(req, res) {
  const businessTypes = await prisma.businessType.findMany({
    orderBy: {
      name: "asc"
    }
  });
  return res.json(businessTypes);
}
module.exports = {
  listBusinessTypes
};