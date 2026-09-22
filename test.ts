import { prisma } from './lib/prisma';

async function main() {
  try {
    const res = await prisma.category.findFirst();
    console.log(res);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
