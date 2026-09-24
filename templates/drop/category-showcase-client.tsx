"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Picture } from "../shared";
import type { CategoryTile } from "../types";

/**
 * A directory, not a mosaic: category names set in huge type, stacked as real links. Hovering
 * (or focusing, for keyboard users) one swaps the image shown in the panel beside it — desktop
 * only, since there's no hover on a phone, where each row gets its own small thumbnail instead.
 */
export function CategoryShowcase({ categories }: { categories: CategoryTile[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-16">
      <ul className="border-t border-border">
        {categories.map((c, i) => (
          <li key={c.id} className="border-b border-border">
            <Link
              href={c.href}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              className={cn(
                "group flex items-center justify-between gap-6 py-5 transition-colors sm:py-7",
                active === i ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="min-w-0 truncate text-3xl font-black uppercase leading-none tracking-tight sm:text-5xl">
                {c.label}
              </span>
              <span className="flex shrink-0 items-center gap-4">
                <span className="relative size-14 overflow-hidden bg-secondary lg:hidden">
                  <Picture src={c.image} alt="" className="size-full" imgClassName="object-cover" />
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "hidden size-2 shrink-0 rounded-full bg-accent transition-opacity lg:inline-block",
                    active === i ? "opacity-100" : "opacity-0",
                  )}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="relative hidden overflow-hidden bg-secondary lg:block">
        {categories.map((c, i) => (
          <div
            key={c.id}
            aria-hidden={active !== i}
            className={cn("absolute inset-0 transition-opacity duration-700", active === i ? "opacity-100" : "opacity-0")}
          >
            <Picture src={c.image} alt={c.label} className="h-full w-full" imgClassName="object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}
