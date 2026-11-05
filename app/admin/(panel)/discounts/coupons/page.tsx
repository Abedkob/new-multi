import Link from "next/link";
import { Plus, TicketPercent } from "lucide-react";
import { AdminPageSizeControl } from "@/components/admin-page-size-control";
import { AdminPagination } from "@/components/admin-pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCouponsPage } from "@/lib/data/coupons";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { DiscountTypeNav } from "../discount-type-nav";
import { CouponActions } from "./coupon-actions";
import { CouponAnnouncementState, CouponOfferLabel, CouponStatusBadge } from "./coupon-summary";
import { CouponScheduleLabel } from "./coupon-schedule-label";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await requireCapability("discounts:write");
  const t = await getT();
  const query = await searchParams;
  const archived = first(query.archived) === "1";
  const requested = Number(first(query.page)) || 1;
  const requestedPageSize = Number(first(query.perPage)) || 25;
  const { items, total, page, pages, pageSize } = await listCouponsPage(tenantId, requested, archived, requestedPageSize);
  const now = new Date();
  const createButton = <Link href="/admin/discounts/coupons/new" className={buttonVariants()}><Plus className="size-4" aria-hidden />{t("coupons.page.create")}</Link>;
  return <div className="grid gap-4">
    <PageHeader title={t("coupons.page.title")} description={t("coupons.page.description")} actions={createButton} />
    <DiscountTypeNav current="coupons" />
    {first(query.created) === "1" && <p role="status" tabIndex={-1} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{t("coupons.page.created")}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{t("coupons.page.explainer")}</p>
      <Link href={archived ? "/admin/discounts/coupons" : "/admin/discounts/coupons?archived=1"} className="text-sm font-medium underline underline-offset-4">{archived ? t("coupons.page.viewCurrent") : t("coupons.page.viewArchived")}</Link>
    </div>
    <AdminPageSizeControl page={page} pageSize={pageSize} total={total} noun={t("coupons.page.noun")} />
    <Card className="gap-0 overflow-hidden py-0">
      {!items.length ? <EmptyState icon={TicketPercent} title={archived ? t("coupons.empty.archived") : t("coupons.empty.title")} action={archived ? undefined : createButton}>{t("coupons.empty.body")}</EmptyState> : <>
        <div className="divide-y md:hidden">{items.map((coupon) => <article key={coupon.id} className="grid gap-4 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={coupon.archivedAt ? "#" : `/admin/discounts/coupons/${coupon.id}/edit`} className="font-medium hover:underline">{coupon.name || coupon.code}</Link>{coupon.name && <p dir="ltr" className="text-xs text-muted-foreground">{coupon.code}</p>}<p className="mt-1 text-sm"><CouponOfferLabel coupon={coupon} products={coupon._count.products} /></p></div><CouponStatusBadge coupon={coupon} at={now} /></div><p className="text-xs text-muted-foreground"><CouponScheduleLabel startsAt={coupon.startsAt?.toISOString() ?? null} endsAt={coupon.endsAt?.toISOString() ?? null} /></p><p className="text-sm"><CouponAnnouncementState coupon={coupon} at={now} /></p><CouponActions id={coupon.id} code={coupon.code} archived={!!coupon.archivedAt} enabled={coupon.isEnabled} /></article>)}</div>
        <div className="hidden md:block"><Table><TableHeader><TableRow className="bg-muted/50"><TableHead className="ps-4">{t("coupons.table.coupon")}</TableHead><TableHead>{t("coupons.table.offer")}</TableHead><TableHead>{t("coupons.table.status")}</TableHead><TableHead>{t("coupons.table.announcement")}</TableHead><TableHead className="pe-4 text-end"><span className="sr-only">{t("common.actionsSr")}</span></TableHead></TableRow></TableHeader><TableBody>{items.map((coupon) => <TableRow key={coupon.id}><TableCell className="ps-4"><Link href={coupon.archivedAt ? "#" : `/admin/discounts/coupons/${coupon.id}/edit`} className="font-medium hover:underline">{coupon.name || coupon.code}</Link>{coupon.name && <p dir="ltr" className="text-xs text-muted-foreground">{coupon.code}</p>}</TableCell><TableCell><CouponOfferLabel coupon={coupon} products={coupon._count.products} /></TableCell><TableCell><CouponStatusBadge coupon={coupon} at={now} /><p className="mt-1 text-xs text-muted-foreground"><CouponScheduleLabel startsAt={coupon.startsAt?.toISOString() ?? null} endsAt={coupon.endsAt?.toISOString() ?? null} /></p></TableCell><TableCell className="text-sm"><CouponAnnouncementState coupon={coupon} at={now} /></TableCell><TableCell className="pe-4"><CouponActions id={coupon.id} code={coupon.code} archived={!!coupon.archivedAt} enabled={coupon.isEnabled} /></TableCell></TableRow>)}</TableBody></Table></div>
      </>}
    </Card>
    <AdminPagination basePath="/admin/discounts/coupons" page={page} pages={pages} total={total} noun={t("coupons.page.noun")} params={{ ...(archived ? { archived: "1" } : {}), ...(pageSize === 25 ? {} : { perPage: String(pageSize) }) }} />
  </div>;
}
