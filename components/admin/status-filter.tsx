import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The row of pills that filters a list by status. See ADMIN_UI.md §6.
 *
 * Orders and the till each had their own copy of this: the same markup and the same behaviour,
 * styled differently — one `border-primary bg-primary text-primary-foreground` at `py-1.5`, the
 * other `bg-foreground text-background` at `py-1`. Two lists that filter the same way should not
 * look like two different controls.
 *
 * Real `<Link>`s inside a `<nav>`, like `SectionTabs`, so a filtered list is a URL: bookmarkable,
 * shareable, and still filtered after a reload. `aria-current="page"` marks the active pill, which
 * is what a screen reader announces — the colour alone would say nothing.
 */
export type StatusFilterTab = {
  /** Compared against `current` to find the active pill. */
  key: string;
  label: string;
  /** Shown in parentheses after the label. Omit for a filter with nothing to count. */
  count?: number;
  href: string;
  /** A colour dot for a status that has one (orders). Tailwind classes for a `size-2` span. */
  dotClassName?: string;
};

export function StatusFilter({
  tabs,
  current,
  ariaLabel,
}: {
  tabs: readonly StatusFilterTab[];
  current: string;
  ariaLabel: string;
}) {
  return (
    // The negative margin plus padding lets a pill's focus ring sit outside the scroll box
    // without being clipped, while the row still scrolls on a phone.
    <nav aria-label={ariaLabel} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.dotClassName && (
              <span className={cn("size-2 rounded-full", tab.dotClassName)} aria-hidden />
            )}
            {tab.label}
            {tab.count !== undefined && <span className="tabular-nums">({tab.count})</span>}
          </Link>
        );
      })}
    </nav>
  );
}
