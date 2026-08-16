const {
  validateEnv
} = require("./config/env");
validateEnv();
const app = require("./app");
const prisma = require("./config/db");
const {
  initSocket
} = require("./socket");
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Queue SaaS API listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
});
initSocket(server);
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