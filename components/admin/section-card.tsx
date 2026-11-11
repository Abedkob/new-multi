/**
 * The one panel in /admin. See ADMIN_UI.md §3.
 *
 * `rounded-lg border bg-card p-4`, and the three things that were wrong before it existed:
 *
 *  1. **It names its surface.** The panel background was left off 23 of the 33 hand-rolled
 *     panels, and the page shell is `bg-muted/40` — so those panels were transparent and showed
 *     the grey page through them, sitting beside opaque ones on the same screen. One was
 *     `bg-muted/40` itself: the same colour as the page, visible only by its border.
 *  2. **One radius.** `--radius` is 0.625rem; `rounded-lg` is exactly it, `rounded-md` is 0.8x
 *     and `rounded-xl` is 1.4x. All three were in use.
 *  3. **The title belongs to the panel.** A heading sitting loose above a box drifts out of
 *     alignment the first time somebody changes the gap.
 *
 * Deliberately NOT `components/ui/card`, which is a different object (ring instead of border,
 * `rounded-xl`, `overflow-hidden`, its own spacing variable, `font-heading` on the title — a
 * token scoped to a *store's* theme). That stays for /platform and /login.
 */
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  footer,
  className,
  bodyClassName,
  children,
  ...props
  // `title` is omitted from the element's own props: <section> has an HTML title attribute of
  // type string, and intersecting it with a ReactNode prop yields `string & ReactNode`, which
  // nothing can satisfy. The compiler caught this the first time a title held an element.
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /**
   * A mark beside the title, in a muted chip. Only earns its place on a long multi-section form
   * — the product form is the one that has it — where the icons are what let someone find
   * "photos" again after scrolling. A panel that is one of two on a screen does not need one,
   * and a screen where only some panels have icons looks broken.
   */
  icon?: LucideIcon;
  /** Controls for this panel, on the same line as its title. */
  actions?: React.ReactNode;
  /** A muted strip under the body — totals, a save row, a caveat. */
  footer?: React.ReactNode;
  bodyClassName?: string;
}) {
  // A panel with a heading and nothing under it is a notice, and it keeps its full padding —
  // `pb-0` is there to close the gap to a body, so with no body there is nothing to close.
  const hasBody = children !== undefined && children !== null && children !== false;

  return (
    // `min-w-0` is load-bearing, not tidiness. A panel is almost always a grid item, and a grid
    // item's `min-width` defaults to `auto` — its min-content. So a panel holding a table grew to
    // the table's natural width, every ancestor grew with it, and `components/ui/table`'s own
    // `overflow-x-auto` never fired because its `w-full` container was never narrower than its
    // contents. The result was the PAGE scrolling sideways instead of the table: /admin/products
    // measured 984px of document at a 375px viewport, /admin/orders 538px. §11 says no
    // horizontal page scroll, and no class name on any of those screens was wrong, which is why
    // the static check could not see it.
    <section className={cn("min-w-0 rounded-lg border bg-card", className)} {...props}>
      {(title || actions) && (
        <div
          className={cn(
            "flex flex-wrap items-start justify-between gap-3 p-4",
            hasBody && "pb-0",
          )}
        >
          <div className="flex min-w-0 gap-3">
            {Icon && (
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            <div className="grid min-w-0 gap-1">
              {title && <h2 className="text-lg font-medium leading-snug">{title}</h2>}
              {description && (
                <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {hasBody && <div className={cn("p-4", bodyClassName)}>{children}</div>}
      {footer && (
        <div className="flex flex-wrap items-center gap-3 rounded-b-lg border-t bg-muted/30 px-4 py-3 text-sm">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * A heading for a block that is not a panel — a group of panels, or a stretch of a long form.
 *
 * `text-lg font-medium`, the same step as a panel's title, because they are the same altitude:
 * what differs is whether the thing underneath has a box around it. An `h2`, so a page under a
 * section layout (Analytics, Marketing) starts here rather than at a second `h1`.
 */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="grid min-w-0 gap-1">
        <h2 className="text-lg font-medium leading-snug">{title}</h2>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
