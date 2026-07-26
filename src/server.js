const { validateEnv } = require("./config/env");
validateEnv(); // fail fast BEFORE requiring anything else that depends on env vars

const app = require("./app");
const prisma = require("./config/db");

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`Queue SaaS API listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
});

// Graceful shutdown: when you stop the process (Ctrl+C, or a deploy
// platform sending SIGTERM), close the HTTP server AND the Prisma
// connection pool cleanly instead of just killing the process mid-request.
// Without this, in-flight requests can get cut off and MySQL connections
// can be left dangling until they time out on their own.
async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log("Server and database connection closed.");
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
