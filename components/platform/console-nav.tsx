"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The platform console's top bar. Was `components/dashboard-nav.tsx`, a name that promised a
 * shared primitive: `/platform` was its only caller, and `/admin` has had its own sidebar since
 * the panel's first commit. One caller, so it moved here and took the console's concerns with
 * it.
 *
 * Two things it did not do before:
 *
 *  1. **Say where you are.** Five links, every one the same muted grey, on a console whose
 *     sections look alike at a glance (two of them are called Analytics and Notifications). The
 *     current section now carries `aria-current="page"` and a filled chip — the `StoreNav`
 *     treatment one level down, so the two rows of navigation on a store page agree with each
 *     other.
 *  2. **Separate navigation from the one action that is not navigation.** "New store" was the
 *     fifth link in a row of four sections, so the row mixed "go and look at this" with "go and
 *     create something". It is a button on the right now, beside the identity.
 *
 * The active chip is `bg-muted` rather than the accent: this subtree is monochrome
 * (`console-neutral` in app/globals.css), so emphasis here is weight and surface, never hue.
 */
export type ConsoleNavLink = {
  href: string;
  label: string;
  /** True for the console root, which a prefix match would otherwise mark active everywhere. */
  exact?: boolean;
};

export function ConsoleNav({
  title,
  links,
  action,
  who,
  widthClass = "max-w-5xl",
}: {
  title: string;
  links: readonly ConsoleNavLink[];
  /** The one create action, kept out of the section row. */
  action?: { href: string; label: string };
  who: string;
  widthClass?: string;
}) {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background">
      <div
        className={cn(
          "mx-auto flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3",
          widthClass,
        )}
      >
        <Link href="/platform" className="font-semibold">
          {title}
        </Link>
        <nav aria-label={title} className="flex flex-1 flex-wrap items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.exact
              ? pathname === l.href
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        {/* `buttonVariants` on a Link, not `<Button asChild>`: this project's Button is a plain
            button with no Slot, so a nested anchor is how every other call site does it. */}
        {action && (
          <Link href={action.href} className={cn(buttonVariants({ size: "sm" }))}>
            {action.label}
          </Link>
        )}
        <span className="text-sm text-muted-foreground">{who}</span>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Logout
          </Button>
        </form>
      </div>
    </header>
  );
}
