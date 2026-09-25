import Link from "next/link";
import { BadgePercent, Plus } from "lucide-react";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listDiscountsPage } from "@/lib/data/discounts";
import { requireOwner } from "@/lib/session";
import { DiscountCampaignActions } from "./discount-actions";
import { DiscountScheduleLabel, DiscountStatusBadge, DiscountValueLabel } from "./discount-summary";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOwner();
  const query = await searchParams;
  const requested = Number.parseInt(first(query.page) ?? "1", 10) || 1;
  const requestedPageSize = Number.parseInt(first(query.perPage) ?? "25", 10) || 25;
  const includeArchived = first(query.archived) === "1";
  const { items, total, page, pages, pageSize } = await listDiscountsPage(
    tenantId,
    requested,
    includeArchived,
    requestedPageSize,
  );
  const now = new Date();
  const newButton = (
    <Link href="/admin/discounts/new" className={buttonVariants()}>
      <Plus className="size-4" aria-hidden /> New discount
    </Link>
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Discounts"
        description="Run automatic product discounts. Shoppers always receive the best eligible price."
        actions={newButton}
      />
      <nav aria-label="Discount views" className="flex w-fit rounded-lg border bg-muted/30 p-1">
        <Link
          href={pageSize === 25 ? "/admin/discounts" : `/admin/discounts?perPage=${pageSize}`}
          aria-current={!includeArchived ? "page" : undefined}
          className={buttonVariants({ variant: !includeArchived ? "secondary" : "ghost", size: "sm" })}
        >
          Current
        </Link>
        <Link
          href={`/admin/discounts?${new URLSearchParams({
            archived: "1",
            ...(pageSize === 25 ? {} : { perPage: String(pageSize) }),
          })}`}
          aria-current={includeArchived ? "page" : undefined}
          className={buttonVariants({ variant: includeArchived ? "secondary" : "ghost", size: "sm" })}
        >
          All discounts
        </Link>
      </nav>
      <AdminPageSizeControl page={page} pageSize={pageSize} total={total} noun="discounts" />
      <Card className="gap-0 overflow-hidden py-0">
        {items.length === 0 ? (
          <EmptyState icon={BadgePercent} title={includeArchived ? "No discounts found." : "No discounts yet."} action={includeArchived ? undefined : newButton}>
            Create a percentage or fixed-amount discount, then choose which products receive it.
          </EmptyState>
        ) : (
          <>
            <div className="divide-y md:hidden">
              {items.map((discount) => (
                <article key={discount.id} className="grid gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {discount.archivedAt ? (
                        <h2 className="truncate font-medium">{discount.name}</h2>
                      ) : (
                        <h2><Link href={`/admin/discounts/${discount.id}/edit`} className="font-medium hover:underline">{discount.name}</Link></h2>
                      )}
                      <p className="mt-0.5 text-sm text-muted-foreground"><DiscountValueLabel type={discount.type} value={discount.value} /></p>
                    </div>
                    <DiscountStatusBadge discount={discount} at={now} />
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Schedule</dt>
                      <dd className="mt-0.5"><DiscountScheduleLabel startsAt={discount.startsAt} endsAt={discount.endsAt} /></dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Products</dt>
                      <dd className="mt-0.5 tabular-nums">{discount._count.products}</dd>
                    </div>
                  </dl>
                  <div className="flex justify-end border-t pt-3">
                    <DiscountCampaignActions id={discount.id} name={discount.name} archived={discount.archivedAt !== null} />
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="pl-4">Discount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead className="text-right">Products</TableHead>
                    <TableHead className="pr-4 text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((discount) => (
                  <TableRow key={discount.id}>
                    <TableCell className="pl-4">
                      {discount.archivedAt ? <span className="font-medium">{discount.name}</span> : <Link href={`/admin/discounts/${discount.id}/edit`} className="font-medium hover:underline">{discount.name}</Link>}
                      <p className="text-xs text-muted-foreground">
                        <DiscountValueLabel type={discount.type} value={discount.value} />
                      </p>
                    </TableCell>
                    <TableCell><DiscountStatusBadge discount={discount} at={now} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <DiscountScheduleLabel startsAt={discount.startsAt} endsAt={discount.endsAt} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{discount._count.products}</TableCell>
                    <TableCell className="pr-4">
                      <DiscountCampaignActions id={discount.id} name={discount.name} archived={discount.archivedAt !== null} />
                    </TableCell>
                  </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
      <AdminPagination
        basePath="/admin/discounts"
        page={page}
        pages={pages}
        total={total}
        noun="discounts"
        params={{
          ...(includeArchived ? { archived: "1" } : {}),
          ...(pageSize === 25 ? {} : { perPage: String(pageSize) }),
        }}
      />
    </div>
  );
}
