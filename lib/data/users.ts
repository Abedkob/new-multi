import { prisma } from "@/lib/prisma";

export function setPassword(userId: string, passwordHash: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
    select: { id: true },
  });
}
