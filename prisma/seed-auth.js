// One-time script: replaces the placeholder password_hash values from
// seed.sql with a REAL bcrypt hash, so you can actually log in as these
// test users. Run with: node prisma/seed-auth.js
//
// Why this is a separate script from seed.sql: hashing a password is
// application logic (it needs the bcrypt library and a chosen cost
// factor), not something you'd normally hand-write as a raw SQL INSERT.
// This is exactly the kind of step that belongs in Node, not SQL.

const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");

const TEST_PASSWORD = "Password123!";

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const emails = [
    "superadmin@queueplatform.example.com",
    "kwame@oceanview.example.com",
    "ama@oceanview.example.com",
    "yaw@accragh.example.com",
    "efua@accragh.example.com",
  ];

  for (const email of emails) {
    const result = await prisma.user.updateMany({
      where: { email },
      data: { passwordHash },
    });

    if (result.count === 0) {
      console.log(` No user found with email ${email} — skipped`);
    } else {
      console.log(`✔ Password set for ${email}`);
    }
  }

  console.log(`\nAll updated users can now log in with password: ${TEST_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
