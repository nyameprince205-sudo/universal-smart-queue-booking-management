// A single, shared PrismaClient instance.
//
// Why this file exists: in dev mode, nodemon restarts your process on every
// file save. If every module did `new PrismaClient()` itself, you'd rack up
// a new pool of MySQL connections on every restart until you hit MySQL's
// connection limit. Attaching the client to `global` means hot-reloads reuse
// the same instance instead of creating a new one each time.

const { PrismaClient } = require("@prisma/client");

const globalForPrisma = global;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
