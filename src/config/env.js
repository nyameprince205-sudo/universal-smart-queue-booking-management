require("dotenv").config();
const REQUIRED_VARS = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
function validateEnv() {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}\n` + `Copy .env.example to .env and fill these in before starting the server.`);
    process.exit(1);
  }
}
module.exports = {
  validateEnv
};