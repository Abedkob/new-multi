import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../generated/prisma/client";

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env before seeding.",
    );
  }
  if (password.length < 8) {
    throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    // The platform admin chose this password themselves, so no forced change.
    // Re-running the seed resets the admin's password to the env value.
    const admin = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: "Platform Admin",
        passwordHash,
        role: "PLATFORM_ADMIN",
        mustChangePassword: false,
      },
      update: {
        passwordHash,
        role: "PLATFORM_ADMIN",
        mustChangePassword: false,
      },
    });
    console.log(`Platform admin ready: ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
