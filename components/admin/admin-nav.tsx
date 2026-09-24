"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExternalLink,
  BadgePercent,
  FolderTree,
  House,
  KeyRound,
  LogOut,
  Package,
  Paintbrush,
  Share2,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Home", icon: House },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag, badge: "pending" as const },
  { href: "/admin/delivery", label: "Delivery", icon: Truck },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/discounts", label: "Discounts", icon: BadgePercent },
  { href: "/admin/categories", label: "Categories", icon: FolderTree },
  { href: "/admin/content", label: "Store content", icon: Paintbrush },
  { href: "/admin/social-links", label: "Social links", icon: Share2 },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The owner admin's navigation: a sidebar on desktop, a sticky top bar with a scrolling link
 * strip on phones. Pending orders show as a badge so new orders are never missed.
 */
export function AdminNav({
  storeName,
  storeUrl,
  email,
  pendingOrders,
}: {
  storeName: string;
  storeUrl: string;
  email: string;
  pendingOrders: number;
}) {
  const pathname = usePathname();
  const initial = [...storeName.trim()][0]?.toUpperCase() ?? "S";

  const links = (compact: boolean) =>
    LINKS.map(({ href, label, icon: Icon, badge }) => {
      const active = isActive(pathname, href);
      const count = badge === "pending" ? pendingOrders : 0;
      return (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
            compact && "gap-2 px-3 py-1.5",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{label}</span>
          {count > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs leading-5 font-semibold tabular-nums",
                active ? "bg-primary-foreground text-primary" : "bg-amber-500 text-white",
              )}
              aria-label={`${count} pending`}
            >
              {count}
            </span>
          )}
        </Link>
      );
    });

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-background md:flex">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{storeName}</p>
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              View your store <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </div>
        <nav aria-label="Store admin" className="grid gap-1 p-3">
          {links(false)}
        </nav>
        <div className="mt-auto grid gap-1 border-t p-3">
          <p className="truncate px-3 pb-1 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
          <Link
            href="/admin/change-password"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <KeyRound className="size-4" aria-hidden /> Change password
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Phone header */}
      <header className="sticky top-0 z-20 border-b bg-background md:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {initial}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{storeName}</p>
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View your store"
            className="grid size-8 place-items-center rounded-lg border text-muted-foreground"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Log out"
              className="grid size-8 place-items-center rounded-lg border text-muted-foreground"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
        <nav aria-label="Store admin" className="flex gap-1 overflow-x-auto px-3 pb-3">
          {links(true)}
        </nav>
      </header>
    </>
  );
}
