import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/locale";

/** Previous / "Page 2 of 7" / Next for the owner admin's long lists. Hidden with one page. */
export async function AdminPagination({
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
  const t = await getT();
  const href = (p: number) => {
    const q = new URLSearchParams(params);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const outline = buttonVariants({ variant: "outline", size: "sm" });
  return (
    <nav
      aria-label={t("common.paginationAriaLabel")}
      data-testid="admin-pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={outline}>
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /> {t("common.previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        {t("common.page")} {page} {t("common.of")} {pages} &middot; {total} {noun}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={outline}>
          {t("common.next")} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
