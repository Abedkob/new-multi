"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useCart } from "@/lib/cart/cart";
import { cn } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";

/** Small interactive pieces the (server-rendered) navbars drop in. */

/** Search form: sends the shopper to the search page. */
export function SearchBox({
  slug,
  placeholder,
  buttonLabel,
  className,
  inputClassName,
  buttonClassName,
}: {
  slug: string;
  placeholder: string;
  buttonLabel: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
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
    if (!term) {
      setSuggestions([]);
      return;
    }
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`/api/store/${slug}/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data);
        }
      } catch (err) {
        // ignore
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
        router.push(`/store/${slug}/search${term ? `?q=${encodeURIComponent(term)}` : ""}`);
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
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-background border border-border rounded-lg shadow-xl overflow-hidden z-50">
          <ul className="py-1">
            {suggestions.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/store/${slug}/product/${p.slug}`}
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
  slug,
  className,
}: {
  slug: string;
  className?: string;
}) {
  const { count } = useCart();

  return (
    <Link
      href={`/store/${slug}/cart`}
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

import { Menu, X } from "lucide-react";

export function CategoryMenu({
  categories,
  className,
}: {
  categories: { id: string; label: string; href: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button 
        onClick={() => setOpen(true)} 
        className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary transition-colors" 
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>
      
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xs bg-background p-6 shadow-2xl h-full border-r border-border animate-in slide-in-from-left">
             <div className="flex items-center justify-between mb-8">
               <span className="text-lg font-semibold tracking-tight">Categories</span>
               <button 
                 onClick={() => setOpen(false)} 
                 className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary transition-colors"
                 aria-label="Close menu"
               >
                 <X className="h-5 w-5" />
               </button>
             </div>
             <nav className="flex flex-col gap-6">
               {categories.map(c => (
                 <Link key={c.id} href={c.href} onClick={() => setOpen(false)} className="text-lg font-medium hover:text-primary transition-colors">
                   {c.label}
                 </Link>
               ))}
             </nav>
          </div>
        </div>
      )}
    </div>
  );
}
