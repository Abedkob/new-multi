import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { getCoupon, getSelectedAnnouncedCoupon, listCouponProductChoices } from "@/lib/data/coupons";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { updateCouponAction } from "../../../coupons/actions";
import { CouponForm } from "../../../coupons/coupon-form";

export default async function EditCouponPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const { id } = await params;
  const [coupon, products, another] = await Promise.all([getCoupon(tenantId, id), listCouponProductChoices(tenantId), getSelectedAnnouncedCoupon(tenantId, id)]);
  if (!coupon || coupon.archivedAt) notFound();
  return <div className="grid gap-5"><PageHeader title={coupon.name || coupon.code} description={coupon.hasOrders ? t("coupons.edit.usedDescription") : t("coupons.edit.description")} back={{ href: "/admin/discounts/coupons", label: t("coupons.page.title") }} /><CouponForm action={updateCouponAction.bind(null, id)} products={products} submitLabel={t("common.saveChanges")} codeLocked={coupon.hasOrders} announcedCouponLabel={another?.name || another?.code || null} defaults={{ name: coupon.name || "", code: coupon.code, scope: coupon.scope, type: coupon.type || "PERCENTAGE", value: coupon.type === "FIXED_AMOUNT" ? ((coupon.value || 0) / 100).toFixed(2) : String(coupon.value || 10), isEnabled: coupon.isEnabled, startsAt: coupon.startsAt?.toISOString() || "", endsAt: coupon.endsAt?.toISOString() || "", isAnnounced: coupon.isAnnounced, announcementText: coupon.announcementText || "Use {code} at checkout", productIds: coupon.products.map((product) => product.productId), revision: coupon.revision }} /></div>;
}
