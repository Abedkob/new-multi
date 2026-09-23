import { prisma } from "@/lib/prisma";

/** Also bumps sessionVersion, so every other session of this user is revoked (lib/session.ts). */
export function setPassword(userId: string, passwordHash: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
    select: { id: true },
  });
}
