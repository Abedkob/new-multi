import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import { DUMMY_HASH, verifyPassword } from "@/lib/passwords";
import { loginSchema } from "@/lib/validation";
import type { AppClaims } from "@/lib/roles";

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { tenant: { select: { id: true } } },
        });
        // Always run a bcrypt compare so unknown emails cost the same time.
        const valid = await verifyPassword(
          password,
          user?.passwordHash ?? DUMMY_HASH,
        );
        if (!user || !valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenant?.id ?? null,
          mustChangePassword: user.mustChangePassword,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      const claims = token as unknown as AppClaims;
      if (user) {
        claims.userId = user.id!;
        claims.role = user.role;
        claims.tenantId = user.tenantId;
        claims.mustChangePassword = user.mustChangePassword;
        claims.sessionVersion = user.sessionVersion;
      } else if (trigger === "update") {
        // Never trust client-supplied update data: re-read the flag from the DB. sessionVersion
        // is deliberately NOT refreshed here — any cookie holder can trigger an update, so a
        // revoked token must stay revoked (lib/session.ts rejects it); only a fresh login
        // issues the new version.
        const fresh = await prisma.user.findUnique({
          where: { id: claims.userId },
          select: { mustChangePassword: true, sessionVersion: true },
        });
        if (fresh && fresh.sessionVersion === (claims.sessionVersion ?? 0)) {
          claims.mustChangePassword = fresh.mustChangePassword;
        }
      }
      return token;
    },
  },
});
