"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { searchStockItemsAction, type StockPickerItem } from "@/app/admin/(panel)/stock/actions";

/**
 * Find a product option and add it to the document being built.
 *
 * Modelled on `products/category-picker.tsx`, the repo's only combobox, with the keyboard support
 * that one lacks: ↑/↓ to move, Enter to take, Escape to close, and `aria-activedescendant` so a
 * screen reader is told which row is highlighted rather than left to infer it from a colour. Five
 * lines can be entered without touching the mouse, which is how a stockroom actually works.
 *
 * Backed by a server action, debounced at 250ms, needing two characters and capped at twenty rows
 * — a `?q=` round trip would remount the editor above and lose every line typed so far (the till
 * learned that), and an unanchored one-character search is a scan of the whole catalogue that
 * answers nothing.
 *
 * It never filters out what is already on the document. A delivery that arrived in two boxes is
 * two lines of the same option, and the editor merges them.
 */
export function VariantPicker({
  onPick,
  disabled,
}: {
  onPick: (item: StockPickerItem) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const listId = useId();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<StockPickerItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [searching, startSearch] = useTransition();
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const result = await searchStockItemsAction(term);
        if (result.ok) {
          setItems(result.items);
          setActive(0);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Derived, not stored: with fewer than two characters there is nothing to show, whatever the
  // last search returned.
  const visible = search.trim().length >= 2 ? items : null;

  function take(item: StockPickerItem) {
    onPick(item);
    setSearch("");
    setItems(null);
    setActive(0);
    box.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible || visible.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(visible.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = visible[active];
      if (item) take(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setItems(null);
    }
  }

  return (
    <div className="grid gap-2">
      <Input
        ref={box}
        type="search"
        role="combobox"
        aria-expanded={!!visible && visible.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          visible && visible[active] ? `${listId}-${visible[active].variantId}` : undefined
        }
        autoComplete="off"
        disabled={disabled}
        value={search}
        placeholder={t("stock.picker.placeholder")}
        aria-label={t("stock.picker.label")}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {searching && <p className="text-sm text-muted-foreground">{t("stock.picker.searching")}</p>}
      {search.trim().length > 0 && search.trim().length < 2 && (
        <p className="text-sm text-muted-foreground">{t("stock.picker.keepTyping")}</p>
      )}
      {visible?.length === 0 && !searching && (
        <p className="text-sm text-muted-foreground">{t("stock.picker.noResults")}</p>
      )}
      {visible && visible.length > 0 && (
        <ul id={listId} role="listbox" aria-label={t("stock.picker.label")} className="grid gap-1">
          {visible.map((item, i) => (
            <li key={item.variantId} role="presentation">
              <button
                type="button"
                id={`${listId}-${item.variantId}`}
                role="option"
                aria-selected={i === active}
                data-testid="stock-picker-option"
                onMouseEnter={() => setActive(i)}
                onClick={() => take(item)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md border bg-background p-3 text-start",
                  i === active && "border-primary",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.productName}</span>
                  {item.variantLabel && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.variantLabel}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {item.stock} {t("stock.picker.onShelf")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
