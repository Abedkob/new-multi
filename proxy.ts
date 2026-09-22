import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { homeForRole } from "@/lib/roles";

// Optimistic gate only (reads the JWT, no DB). Pages and server actions repeat
// the role checks via lib/session.ts, and data access is scoped by tenantId.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, req.nextUrl));

  if (pathname === "/login") {
    return user ? redirectTo(homeForRole(user.role)) : undefined;
  }

  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    if (user?.role !== "PLATFORM_ADMIN") return redirectTo("/login");
    return;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (user?.role !== "STORE_OWNER") return redirectTo("/login");
    if (
      user.mustChangePassword &&
      pathname !== "/admin/change-password"
    ) {
      return redirectTo("/admin/change-password");
    }
    return;
  }
});

export const config = {
  matcher: ["/login", "/platform/:path*", "/admin/:path*"],
};
