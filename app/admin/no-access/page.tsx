import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { requireTenantMember } from "@/lib/session";
import { homeForRole } from "@/lib/roles";

/**
 * Where a signed-in member of this store lands when a page is not theirs (D72).
 *
 * It exists because the alternative loops. The refusal cannot be /login: the session cookie is
 * valid, proxy.ts admits both store roles to /admin, and /login sends a signed-in user to
 * homeForRole — so a staff account refused by redirecting to /login would bounce between the
 * two forever. A 404 would be a lie in the other direction: the page is there, it is just not
 * theirs, and someone who has been told "not found" goes looking for a bug.
 *
 * Outside the (panel) route group on purpose, so it does not render the owner's navigation to
 * someone who may not use most of it.
 */
export default async function NoAccessPage() {
  const member = await requireTenantMember({ allowMustChange: true });

  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-16" data-testid="no-access">
      <h1 className="text-2xl font-semibold">That page isn&apos;t yours</h1>
      <p className="text-sm text-muted-foreground">
        You&apos;re signed in as {member.email}, but this part of the dashboard is only for the
        store owner. Nothing is wrong — ask the owner if you need it.
      </p>
      <Link
        href={homeForRole(member.role)}
        className={`${buttonVariants()} justify-self-start`}
      >
        Back to work
      </Link>
    </div>
  );
}
