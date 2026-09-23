"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type StoreNavItem = {
  href: string;
  label: string;
  /** Shown as a small dot when this area still needs setting up. */
  todo?: boolean;
  /** Opens a separate full-screen page (the theme editor) rather than a sidebar section. */
  external?: boolean;
};

/** Vertical sidebar on md+, a horizontally scrolling strip on phones. */
export function StoreNav({ items }: { items: StoreNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Store settings" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {items.map((item) => {
          // The overview is the section root, so it's only active on an exact match.
          const active = item.external
            ? false
            : item.href === items[0].href
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="flex-1">{item.label}</span>
                {item.todo && (
                  <span className="size-1.5 rounded-full bg-amber-500" aria-label="needs setup" />
                )}
                {item.external && <span aria-hidden>↗</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
