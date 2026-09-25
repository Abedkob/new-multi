"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ADMIN_PAGE_SIZES, type AdminPageSize } from "@/lib/admin-pagination";

export function AdminPageSizeControl({
  page,
  pageSize,
  total,
  noun,
}: {
  page: number;
  pageSize: AdminPageSize;
  total: number;
  noun: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const firstVisible = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, total);

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" data-testid="admin-visible-range">
        Showing {firstVisible}&ndash;{lastVisible} of {total} {noun}
      </p>
      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        Show
        <select
          aria-label={`${noun[0].toUpperCase()}${noun.slice(1)} per page`}
          value={pageSize}
          disabled={pending}
          onChange={(event) => {
            const params = new URLSearchParams(searchParams.toString());
            const next = event.target.value;
            params.delete("page");
            if (next === String(ADMIN_PAGE_SIZES[0])) params.delete("perPage");
            else params.set("perPage", next);
            const query = params.toString();
            startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
          }}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          {ADMIN_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        per page
      </label>
    </div>
  );
}
