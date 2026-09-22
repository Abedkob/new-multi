import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Server-side role checks, repeated inside pages and actions in addition to
 * proxy.ts. tenantId comes from the session, never from request input.
 */
export async function requireOwner(opts?: { allowMustChange?: boolean }) {
  const session = await auth();
  const user = session?.user;
  if (!user || user.role !== "STORE_OWNER" || !user.tenantId) {
    redirect("/login");
  }
  if (user.mustChangePassword && !opts?.allowMustChange) {
    redirect("/admin/change-password");
  }
  return {
    userId: user.id,
    tenantId: user.tenantId,
    name: user.name ?? "",
    email: user.email ?? "",
  };
}

export async function requirePlatformAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user || user.role !== "PLATFORM_ADMIN") redirect("/login");
  return { userId: user.id, name: user.name ?? "", email: user.email ?? "" };
}
