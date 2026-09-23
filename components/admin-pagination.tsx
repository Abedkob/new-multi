import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Previous / "Page 2 of 7" / Next for the owner admin's long lists. Hidden with one page. */
export function AdminPagination({
  basePath,
  page,
  pages,
  total,
  noun,
  params = {},
}: {
  basePath: string;
  page: number;
  pages: number;
  total: number;
  noun: string;
  /** Other query params to keep on every page link (a search, a status tab). */
  params?: Record<string, string>;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(params);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const outline = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <nav
      aria-label="Pagination"
      data-testid="admin-pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={outline}>
          &larr; Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages} &middot; {total} {noun}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={outline}>
          Next &rarr;
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
