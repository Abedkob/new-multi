import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small square product photo for admin lists, with a placeholder icon when there's none. */
export function Thumb({ src, className }: { src: string | null | undefined; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail from any host
    <img src={src} alt="" className={cn("size-10 shrink-0 rounded-md border bg-muted object-cover", className)} />
  ) : (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground",
        className,
      )}
    >
      <Package className="size-4" aria-hidden />
    </span>
  );
}
