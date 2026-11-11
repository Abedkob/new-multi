"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExternalLink,
  BadgePercent,
  Boxes,
  FolderTree,
  House,
  KeyRound,
  LogOut,
  Menu,
  Package,
  Paintbrush,
  Share2,
  ShoppingBag,
  Store,
  Truck,
  Megaphone,
  ChartNoAxesColumn,
  Bell,
  Users,
  X,
} from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { setAdminLocaleAction } from "@/app/admin/actions";
import { useT, useLocale } from "@/lib/i18n/context";
import type { Capability } from "@/lib/permissions";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

/**
 * Every destination carries the capability that opens it, and the layout passes in the ones this
 * person has (D72). A link nobody filtered out but the page then refuses is worse than no link:
 * it reads as a broken dashboard rather than as a job description.
 *
 * `Capability` is a type-only import, so the capability table itself — which lives in a module
 * that reaches the session and the database — never reaches the browser.
 */

/**
 * The groups, in the order they are drawn. They answer "what am I here to do", which is why
 * Delivery and Social links sit beside Store content rather than three places apart: all three
 * are things a shopper ends up seeing, and none of them is daily work.
 *
 * `account` is drawn in the footer rather than the body, with the e-mail, the language switch
 * and Log out — so the three things about the *person* (their devices, their colleagues, their
 * password) are in one place instead of at positions 12, 13 and the footer.
 */
const GROUPS = ["daily", "catalogue", "storefront", "insight", "account"] as const;
type Group = (typeof GROUPS)[number];

// `as const` so the values stay literal keys: `t()` takes the dictionary's key union, and a
// widened `string` is refused.
const GROUP_LABEL = {
  daily: "nav.group.daily",
  catalogue: "nav.group.catalogue",
  storefront: "nav.group.storefront",
  insight: "nav.group.insight",
  account: "nav.group.account",
} as const satisfies Record<Group, string>;

type NavLink = {
  href: string;
  label: string;
  icon: typeof House;
  capability: Capability;
  group: Group;
  badge?: "pending";
};

function useNavLinks(): NavLink[] {
  const t = useT();
  return [
    // Daily — what someone opens the panel to do.
    { href: "/admin", label: t("nav.home"), icon: House, capability: "analytics:read", group: "daily" },
    { href: "/admin/orders", label: t("nav.orders"), icon: ShoppingBag, capability: "orders:read", group: "daily", badge: "pending" },
    { href: "/admin/counter", label: t("nav.counter"), icon: Store, capability: "counter:read", group: "daily" },

    // Catalogue — what the shop sells and what it charges. Categories sits next to Products
    // because it is the other half of the same thing; pricing follows both rather than
    // splitting them.
    { href: "/admin/products", label: t("nav.products"), icon: Package, capability: "products:read", group: "catalogue" },
    { href: "/admin/categories", label: t("nav.categories"), icon: FolderTree, capability: "categories:read", group: "catalogue" },
    { href: "/admin/stock", label: t("nav.stock"), icon: Boxes, capability: "stock:read", group: "catalogue" },
    { href: "/admin/discounts", label: t("nav.discounts"), icon: BadgePercent, capability: "discounts:write", group: "catalogue" },

    // Storefront — everything a shopper reads as the store's own word.
    { href: "/admin/content", label: t("nav.storeContent"), icon: Paintbrush, capability: "content:write", group: "storefront" },
    { href: "/admin/delivery", label: t("nav.delivery"), icon: Truck, capability: "settings:write", group: "storefront" },
    { href: "/admin/social-links", label: t("nav.socialLinks"), icon: Share2, capability: "settings:write", group: "storefront" },

    // Insight — the screens that only report. The dashboard is one too, but it is also where
    // the day starts, so it stays at the top of Daily.
    { href: "/admin/analytics", label: t("nav.analytics"), icon: ChartNoAxesColumn, capability: "analytics:read", group: "insight" },
    { href: "/admin/marketing", label: t("nav.marketing"), icon: Megaphone, capability: "marketing:read", group: "insight" },

    // The person, not the store.
    { href: "/admin/notifications", label: t("nav.notifications"), icon: Bell, capability: "notifications:self", group: "account" },
    { href: "/admin/staff", label: t("nav.staff"), icon: Users, capability: "staff:manage", group: "account" },
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

/** Compact single-button toggle for the mobile menu's footer row: shows the current locale's
 * code, tapping switches to the other one. */
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

/** A group heading. Small, quiet and uppercase: it has to separate without competing with the
 * destinations underneath it, which are the things people actually aim at. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="truncate px-3 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  );
}

/** One destination. The active item is the only filled thing in the sidebar, so "where am I" is
 * answered before anything else is read. */
function NavItem({
  link,
  active,
  pendingOrders,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  pendingOrders: number;
  onNavigate?: () => void;
}) {
  const t = useT();
  const Icon = link.icon;
  const count = link.badge === "pending" ? pendingOrders : 0;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">{link.label}</span>
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
}

/**
 * The destinations, drawn as labelled groups. A group with nothing in it is not drawn at all,
 * which is what lets a staff member's sidebar read as a short job description rather than as a
 * stripped-down version of the owner's.
 */
function NavGroups({
  links,
  pathname,
  pendingOrders,
  onNavigate,
}: {
  links: NavLink[];
  pathname: string;
  pendingOrders: number;
  onNavigate?: () => void;
}) {
  const t = useT();
  return (
    <>
      {GROUPS.filter((group) => group !== "account").map((group) => {
        const inGroup = links.filter((link) => link.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="grid gap-1">
            <GroupHeading>{t(GROUP_LABEL[group])}</GroupHeading>
            {inGroup.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                active={isActive(pathname, link.href)}
                pendingOrders={pendingOrders}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * The owner admin's navigation: a sidebar on desktop, and on phones a header with one Menu
 * button that opens the same grouped list.
 *
 * The phone used to get all thirteen destinations as a horizontally scrolling strip, which put
 * most of the product off-screen with nothing saying so — and no amount of reordering fixes a
 * strip whose end you cannot see. A disclosure shows the whole structure at once instead.
 */
export function AdminNav({
  storeName,
  storeUrl,
  email,
  pendingOrders,
  allowed,
}: {
  storeName: string;
  storeUrl: string;
  email: string;
  pendingOrders: number;
  /** The capabilities this person has, resolved on the server (lib/permissions.ts). */
  allowed: Capability[];
}) {
  const pathname = usePathname();
  const t = useT();
  const navLinks = useNavLinks().filter((link) => allowed.includes(link.capability));
  const accountLinks = navLinks.filter((link) => link.group === "account");
  const initial = [...storeName.trim()][0]?.toUpperCase() ?? "S";

  // A menu left open across a navigation would cover the page the person just asked for, so the
  // path it was opened at is part of the state and "open" is derived from it. An effect that
  // closed it on a pathname change would be a second render for every navigation — and would
  // miss the back button, which changes the path without going through a link.
  const [menu, setMenu] = useState({ open: false, at: pathname });
  const menuOpen = menu.open && menu.at === pathname;
  const closeMenu = () => setMenu({ open: false, at: pathname });

  const accountCluster = (onNavigate?: () => void) => (
    <div className="grid gap-1">
      <GroupHeading>{t("nav.group.account")}</GroupHeading>
      {accountLinks.map((link) => (
        <NavItem
          key={link.href}
          link={link}
          active={isActive(pathname, link.href)}
          pendingOrders={pendingOrders}
          onNavigate={onNavigate}
        />
      ))}
      <Link
        href="/admin/change-password"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <KeyRound className="size-4 shrink-0" aria-hidden /> {t("nav.changePassword")}
      </Link>
    </div>
  );

  const identityRow = (compact: boolean) => (
    <>
      <p className="truncate px-3 pt-1 text-xs text-muted-foreground" title={email}>
        {email}
      </p>
      <div className="flex items-center justify-between gap-2 px-1">
        {compact ? <LanguageToggleButton /> : <LanguageSwitcher />}
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden /> {t("nav.logOut")}
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-e bg-background md:flex">
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
        <nav aria-label={t("nav.ariaLabel")} className="grid gap-3 p-3">
          <NavGroups links={navLinks} pathname={pathname} pendingOrders={pendingOrders} />
        </nav>
        <div className="mt-auto grid gap-2 border-t p-3">
          {accountCluster()}
          {identityRow(false)}
        </div>
      </aside>

      {/* Phone header */}
      <header className="sticky top-0 z-20 border-b bg-background md:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setMenu({ open: !menuOpen, at: pathname })}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-nav"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.menu")}
            className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground"
          >
            {menuOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </button>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            {initial}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{storeName}</p>
          {/* Pending orders were the one thing the strip said at a glance, so the count stays
              reachable with the menu shut rather than disappearing behind it. */}
          {pendingOrders > 0 && (
            <Link
              href="/admin/orders"
              className="rounded-full bg-amber-500 px-2 text-xs leading-6 font-semibold text-white tabular-nums"
              aria-label={`${pendingOrders} ${t("nav.pendingSuffix")}`}
            >
              {pendingOrders}
            </Link>
          )}
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("nav.viewStore")}
            className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
        {menuOpen && (
          <nav
            id="admin-mobile-nav"
            aria-label={t("nav.ariaLabel")}
            className="grid max-h-[calc(100vh-4rem)] gap-3 overflow-y-auto border-t p-3"
          >
            <NavGroups
              links={navLinks}
              pathname={pathname}
              pendingOrders={pendingOrders}
              onNavigate={closeMenu}
            />
            <div className="grid gap-2 border-t pt-2">
              {accountCluster(closeMenu)}
              {identityRow(true)}
            </div>
          </nav>
        )}
      </header>
    </>
  );
}
