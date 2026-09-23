import type { NextAuthConfig } from "next-auth";
import type { AppClaims } from "@/lib/roles";

// Edge/proxy-safe half of the config: no database or bcrypt imports here.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    // Copy the claims into the session so pages and actions can read
    // userId / role / tenantId without hitting the database.
    session({ session, token }) {
      const claims = token as unknown as AppClaims;
      session.user.id = claims.userId;
      session.user.role = claims.role;
      session.user.tenantId = claims.tenantId;
      session.user.mustChangePassword = claims.mustChangePassword;
      session.user.sessionVersion = claims.sessionVersion ?? 0;
      return session;
    },
  },
} satisfies NextAuthConfig;
