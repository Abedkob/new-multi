import Link from "next/link";
import { BadgePercent, Plus } from "lucide-react";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listDiscountsPage } from "@/lib/data/discounts";
import { formatPrice } from "@/lib/format";
import { discountStatus } from "@/lib/pricing";
import { requireOwner } from "@/lib/session";
import { archiveDiscountAction, restoreDiscountAction } from "./actions";
import { ArchiveDiscountButton } from "./archive-button";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const STATUS_LABELS = {
  ACTIVE: "Active",
  SCHEDULED: "Scheduled",
  ENDED: "Ended",
  DISABLED: "Disabled",
  ARCHIVED: "Archived",
} as const;

const dateLabel = (value: Date | null) => value
  ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(value)
  : null;

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireOwner();
  const query = await searchParams;
  const requested = Number.parseInt(first(query.page) ?? "1", 10) || 1;
  const includeArchived = first(query.archived) === "1";
  const { items, total, page, pages } = await listDiscountsPage(tenantId, requested, includeArchived);
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
      <div className="flex gap-2 text-sm">
        <Link href="/admin/discounts" className={!includeArchived ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}>Current</Link>
        <span className="text-border">/</span>
        <Link href="/admin/discounts?archived=1" className={includeArchived ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}>Include archived</Link>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        {items.length === 0 ? (
          <EmptyState icon={BadgePercent} title={includeArchived ? "No discounts found." : "No discounts yet."} action={includeArchived ? undefined : newButton}>
            Create a percentage or fixed-amount discount, then choose which products receive it.
          </EmptyState>
        ) : (
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
              {items.map((discount) => {
                const status = discountStatus(discount, now);
                return (
                  <TableRow key={discount.id}>
                    <TableCell className="pl-4">
                      {discount.archivedAt ? <span className="font-medium">{discount.name}</span> : <Link href={`/admin/discounts/${discount.id}/edit`} className="font-medium hover:underline">{discount.name}</Link>}
                      <p className="text-xs text-muted-foreground">
                        {discount.type === "PERCENTAGE" ? `${discount.value}% off` : `${formatPrice(discount.value)} off each unit`}
                      </p>
                    </TableCell>
                    <TableCell><Badge variant={status === "ACTIVE" ? "default" : status === "ENDED" || status === "ARCHIVED" ? "outline" : "secondary"}>{STATUS_LABELS[status]}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {discount.startsAt || discount.endsAt ? (
                        <span>{dateLabel(discount.startsAt) ?? "Immediately"} → {dateLabel(discount.endsAt) ?? "No end"}</span>
                      ) : "Always"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{discount._count.products}</TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-2">
                        {discount.archivedAt ? (
                          <form action={restoreDiscountAction.bind(null, discount.id)}><button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>Restore</button></form>
                        ) : (
                          <>
                            <Link href={`/admin/discounts/${discount.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>Edit</Link>
                            <form action={archiveDiscountAction.bind(null, discount.id)}><ArchiveDiscountButton name={discount.name} /></form>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <AdminPagination basePath="/admin/discounts" page={page} pages={pages} total={total} noun="discounts" params={includeArchived ? { archived: "1" } : {}} />
    </div>
  );
}
