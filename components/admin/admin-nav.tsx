"use client";

import { useTransition } from "react";
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
import { setAdminLocaleAction } from "@/app/admin/actions";
import { useT, useLocale } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

function useNavLinks() {
  const t = useT();
  return [
    { href: "/admin", label: t("nav.home"), icon: House },
    { href: "/admin/orders", label: t("nav.orders"), icon: ShoppingBag, badge: "pending" as const },
    { href: "/admin/delivery", label: t("nav.delivery"), icon: Truck },
    { href: "/admin/products", label: t("nav.products"), icon: Package },
    { href: "/admin/discounts", label: t("nav.discounts"), icon: BadgePercent },
    { href: "/admin/categories", label: t("nav.categories"), icon: FolderTree },
    { href: "/admin/content", label: t("nav.storeContent"), icon: Paintbrush },
    { href: "/admin/social-links", label: t("nav.socialLinks"), icon: Share2 },
  ];
}

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Two-button EN/AR toggle. Flips the client context instantly, then syncs the cookie + refreshes
 * server-rendered content in a transition — no full-page reload either way. */
function LanguageSwitcher() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [, startTransition] = useTransition();

  function handleSwitch(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    startTransition(() => {
      setAdminLocaleAction(next);
    });
  }

  return (
    <div
      role="group"
      aria-label={t("switcher.ariaLabel")}
      className="flex w-fit items-center gap-1 rounded-lg border p-0.5 text-xs font-medium"
    >
      {(["en", "ar"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => handleSwitch(code)}
          aria-pressed={locale === code}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            locale === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {code === "en" ? t("switcher.english") : t("switcher.arabic")}
        </button>
      ))}
    </div>
  );
}

/** Compact single-button toggle for the mobile header's icon-button row: shows the current
 * locale's code, tapping switches to the other one. */
function LanguageToggleButton() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [, startTransition] = useTransition();

  function handleClick() {
    const next: Locale = locale === "en" ? "ar" : "en";
    setLocale(next);
    startTransition(() => {
      setAdminLocaleAction(next);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t("switcher.ariaLabel")}
      className="grid size-8 place-items-center rounded-lg border text-xs font-semibold text-muted-foreground"
    >
      {locale === "en" ? "EN" : "AR"}
    </button>
  );
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
  const t = useT();
  const navLinks = useNavLinks();
  const initial = [...storeName.trim()][0]?.toUpperCase() ?? "S";

  const links = (compact: boolean) =>
    navLinks.map(({ href, label, icon: Icon, badge }) => {
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
              aria-label={`${count} ${t("nav.pendingSuffix")}`}
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e bg-background md:flex">
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
              {t("nav.viewStore")} <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </div>
        <nav aria-label={t("nav.ariaLabel")} className="grid gap-1 p-3">
          {links(false)}
        </nav>
        <div className="mt-auto grid gap-2 border-t p-3">
          <p className="truncate px-3 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
          <LanguageSwitcher />
          <Link
            href="/admin/change-password"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <KeyRound className="size-4" aria-hidden /> {t("nav.changePassword")}
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" aria-hidden /> {t("nav.logOut")}
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
            aria-label={t("nav.viewStore")}
            className="grid size-8 place-items-center rounded-lg border text-muted-foreground"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
          <LanguageToggleButton />
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label={t("nav.logOut")}
              className="grid size-8 place-items-center rounded-lg border text-muted-foreground"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
        <nav aria-label={t("nav.ariaLabel")} className="flex gap-1 overflow-x-auto px-3 pb-3">
          {links(true)}
        </nav>
      </header>
    </>
  );
}
