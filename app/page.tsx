import Link from "next/link";
import { auth } from "@/auth";
import { buttonVariants } from "@/components/ui/button";
import { homeForRole } from "@/lib/roles";

export default async function Home() {
  const session = await auth();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Multi-Tenant Stores
      </h1>
      <p className="max-w-md text-muted-foreground">
        Store accounts are created by the platform owner. Storefronts live at
        /store/&lt;store-slug&gt;.
      </p>
      <Link
        href={session?.user ? homeForRole(session.user.role) : "/login"}
        className={buttonVariants()}
      >
        {session?.user ? "Go to dashboard" : "Sign in"}
      </Link>
    </main>
  );
}
