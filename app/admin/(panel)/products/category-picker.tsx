"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CategoryOption = { id: string; name: string; path: string; depth: number };

/**
 * Searchable, nested category dropdown. The search matches the full path, so typing "nike"
 * finds "Men / Shoes / Nike". Options come from the owner's own store only.
 */
export function CategoryPicker({
  options,
  value,
  onChange,
  id,
}: {
  options: CategoryOption[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.path.toLowerCase().includes(q)) : options;

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? selected.path : "No category"}
        </span>
        <span aria-hidden className="text-xs text-muted-foreground">
          &#9662;
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border bg-background p-2 shadow-md">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories..."
            aria-label="Search categories"
          />
          <ul role="listbox" className="mt-2 max-h-56 overflow-y-auto text-sm">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => pick("")}
                className="w-full rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted"
              >
                No category
              </button>
            </li>
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === o.id}
                  onClick={() => pick(o.id)}
                  style={{ paddingLeft: `${0.5 + (q ? 0 : o.depth) * 1}rem` }}
                  className={cn(
                    "w-full rounded py-1.5 pr-2 text-left hover:bg-muted",
                    value === o.id && "bg-muted font-medium",
                  )}
                >
                  {q ? o.path : o.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
