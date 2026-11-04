"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SectionTab = { href: string; label: string };

/**
 * The tab row inside a section of the admin (Marketing's four tabs, to start with).
 *
 * A client component only because the active tab depends on the path. Each tab is a real
 * `<Link>` to a real route, so a tab is bookmarkable, opens in a new window, and survives a
 * reload — none of which a state-driven tab panel gives you.
 */
export function SectionTabs({ tabs, ariaLabel }: { tabs: readonly SectionTab[]; ariaLabel: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={ariaLabel} className="-mb-px flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
