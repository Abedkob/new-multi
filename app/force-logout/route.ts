import { signOut } from "@/auth";

/**
 * Clears a session cookie whose user row no longer exists (the platform admin deleted their
 * store). `requireOwner()` redirects here instead of straight to `/login`: a plain redirect
 * would leave the JWT cookie in place, and `proxy.ts` (which only reads the JWT, not the DB)
 * would bounce the still-"authenticated" owner straight back to /admin, looping forever.
 * A route handler can clear cookies where a Server Component render can't.
 */
export async function GET() {
  await signOut({ redirectTo: "/login" });
}
