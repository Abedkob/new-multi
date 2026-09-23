"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCart } from "@/lib/cart/cart";
import { cn } from "@/lib/utils";
import { Menu, ShoppingBag, X } from "lucide-react";

/** Small interactive pieces the (server-rendered) navbars drop in. */

/** Search form: sends the shopper to the search page. */
export function SearchBox({
  slug,
  basePath,
  placeholder,
  buttonLabel,
  className,
  inputClassName,
  buttonClassName,
}: {
  /** Used only for the same-origin suggestions fetch (/api/store/[slug]/search), which is
   * always reached by its real slug regardless of custom-domain routing. */
  slug: string;
  /** "" once the store has its own domain, else "/store/[slug]" — see templates/types.ts. */
  basePath: string;
  placeholder: string;
  buttonLabel: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<{ id: string; slug: string; name: string; imageUrl: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`/api/store/${slug}/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
        }
      } catch {
        // Suggestions are a nicety; the search page still works without them.
      }
    }, 250);
    return () => clearTimeout(delay);
  }, [q, slug]);

  return (
    <form
      ref={wrapperRef}
      role="search"
      className={cn("flex items-center gap-2 relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        setShowSuggestions(false);
        router.push(`${basePath}/search${term ? `?q=${encodeURIComponent(term)}` : ""}`);
      }}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={100}
        autoComplete="off"
        className={cn(
          "h-9 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          inputClassName,
        )}
      />
      <button type="submit" className={cn("h-9 shrink-0 px-3 text-sm", buttonClassName)}>
        {buttonLabel}
      </button>
      
      {showSuggestions && q.trim() !== "" && suggestions.length > 0 && (
        <div className="absolute top-full right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-background shadow-xl">
          <ul className="py-1">
            {suggestions.map((p) => (
              <li key={p.id}>
                <Link
                  href={`${basePath}/products/${p.slug}`}
                  onClick={() => setShowSuggestions(false)}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-secondary transition-colors"
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="h-10 w-10 object-cover rounded" />
                  ) : (
                    <div className="h-10 w-10 bg-secondary rounded flex items-center justify-center text-xs text-muted-foreground">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-foreground">{p.name}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

/** "Cart (2)" link with the live item count. */
export function CartLink({
  basePath,
  className,
}: {
  /** "" once the store has its own domain, else "/store/[slug]" — see templates/types.ts. */
  basePath: string;
  className?: string;
}) {
  const { count } = useCart();

  return (
    <Link
      href={`${basePath}/cart`}
      data-testid="cart-link"
      className={className}
    >
      <span className="flex items-center gap-1">
        <ShoppingBag />
        <span data-testid="cart-count">({count})</span>
      </span>
    </Link>
  );
}

/**
 * The store menu: a hamburger button that opens a drawer with search, the shop link, every
 * category and the info pages. Every template shows it on phones (where the desktop links
 * don't fit); some also use it on desktop. The drawer is rendered into the store's theme scope
 * (not inside the header), so a blurred/sticky header can't clip it and it keeps the theme colours.
 */
export function StoreMenu({
  slug,
  basePath,
  shopHref,
  categories,
  pages,
  labels,
  className,
  buttonClassName,
}: {
  slug: string;
  basePath: string;
  shopHref: string;
  categories: { id: string; label: string; href: string }[];
  pages: { slug: string; label: string; href: string }[];
  labels: { menu: string; shop: string; categories: string; searchPlaceholder: string; searchButton: string };
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [host, setHost] = useState<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => setOpen(false);
  const linkClass = "block rounded-md px-2 py-2.5 text-base hover:bg-muted";

  return (
    <div className={className}>
      <button
        ref={button}
        type="button"
        onClick={() => {
          setHost(button.current?.closest("[data-theme-scope]") ?? document.body);
          setOpen(true);
        }}
        className={cn("flex size-10 items-center justify-center rounded-md hover:bg-muted", buttonClassName)}
        aria-label={labels.menu}
        aria-expanded={open}
        data-testid="store-menu-button"
      >
        <Menu className="size-5" />
      </button>

      {open &&
        host &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label={labels.menu}>
            <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={close} />
            <div
              data-testid="store-menu"
              className="relative flex h-full w-[85vw] max-w-sm flex-col overflow-y-auto bg-background p-5 text-foreground shadow-2xl animate-in slide-in-from-left duration-200"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-semibold">{labels.menu}</span>
                <button
                  type="button"
                  onClick={close}
                  className="flex size-10 items-center justify-center rounded-md hover:bg-muted"
                  aria-label="×"
                >
                  <X className="size-5" />
                </button>
              </div>
              <SearchBox
                slug={slug}
                basePath={basePath}
                placeholder={labels.searchPlaceholder}
                buttonLabel={labels.searchButton}
                className="mb-4"
                inputClassName="h-11 w-full flex-1 rounded-lg text-base"
                buttonClassName="h-11 rounded-lg bg-primary px-4 text-primary-foreground"
              />
              <nav className="grid gap-1">
                <Link href={shopHref} onClick={close} className={cn(linkClass, "font-semibold")}>
                  {labels.shop}
                </Link>
                {categories.length > 0 && (
                  <>
                    <p className="mt-4 mb-1 px-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                      {labels.categories}
                    </p>
                    {categories.map((c) => (
                      <Link key={c.id} href={c.href} onClick={close} className={linkClass}>
                        {c.label}
                      </Link>
                    ))}
                  </>
                )}
                {pages.length > 0 && (
                  <div className="mt-4 grid gap-1 border-t border-border pt-4">
                    {pages.map((pg) => (
                      <Link key={pg.slug} href={pg.href} onClick={close} className={cn(linkClass, "text-sm text-muted-foreground")}>
                        {pg.label}
                      </Link>
                    ))}
                  </div>
                )}
              </nav>
            </div>
          </div>,
          host,
        )}
    </div>
  );
}
