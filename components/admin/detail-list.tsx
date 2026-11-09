/**
 * Facts about one record: "Sold by", "Paid by", "When", an address, a note. See ADMIN_UI.md §7.
 *
 * Not a `StatTile` — a detail is not a measurement, so it carries none of that component's rules
 * about exactness, denominators or trends, and it is not a figure-sized number. And not a stack
 * of divs either: this is a real `<dl>`, so a screen reader reads "Paid by, Cash" as the pair it
 * is. The receipt and the order detail each had their own spelling of it, one as a local `Pair`
 * component and one as loose `dt`/`dd` elements with their own classes.
 */
import { cn } from "@/lib/utils";

export function DetailList({
  className,
  children,
  ...props
}: React.ComponentProps<"dl">) {
  return (
    <dl className={cn("grid gap-3 sm:grid-cols-3", className)} {...props}>
      {children}
    </dl>
  );
}

export function Detail({
  label,
  value,
  children,
  className,
}: {
  label: React.ReactNode;
  /** The plain case. For anything that needs markup, pass `children` instead. */
  value?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children ?? value}</dd>
    </div>
  );
}
