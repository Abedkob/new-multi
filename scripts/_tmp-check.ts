import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { slug: true, templateId: true } });
  console.log(tenants);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
