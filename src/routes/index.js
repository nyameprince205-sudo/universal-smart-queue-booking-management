const express = require("express");
const prisma = require("../config/db");

const router = express.Router();

// A REAL health check, not just "the process is running" — it also proves
// Prisma can actually reach MySQL. This is the single most useful endpoint
// during setup: if this fails, you know immediately whether the problem is
// "Express isn't running" or "Express is running but can't reach the DB,"
// which are two completely different things to debug.
router.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: "ok", database: "connected" });
  } catch (err) {
    return res.status(503).json({ status: "error", database: "unreachable" });
  }
});

// Feature routes get mounted here phase by phase, e.g.:
//   router.use("/auth", require("./auth.routes"));        <- Phase 6
//   router.use("/branches", require("./branch.routes"));   <- Phase 7
// Nothing else is mounted yet — that's the whole point of Phase 5.

module.exports = router;
