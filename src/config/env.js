// Why this file exists: a missing DATABASE_URL or JWT secret should crash
// the app the SECOND it starts, with a clear message — not two hours later
// when a random request happens to touch the missing config. This is
// called "failing fast," and it saves you from confusing, intermittent
// bugs that only show up under specific request paths.

require("dotenv").config();

const REQUIRED_VARS = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];

function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Copy .env.example to .env and fill these in before starting the server.`
    );
    process.exit(1);
  }
}

module.exports = { validateEnv };
