import { cn } from "@/lib/utils";
import { LOW_STOCK } from "@/lib/variants";

/** Green / amber / red at a glance, with the number, so owners don't have to read a table. */
export function StockBadge({ stock, className }: { stock: number; className?: string }) {
  const [label, tone] =
    stock <= 0
      ? ["Out of stock", "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900"]
      : stock <= LOW_STOCK
        ? [`Low · ${stock} left`, "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"]
        : [`${stock} in stock`, "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}
