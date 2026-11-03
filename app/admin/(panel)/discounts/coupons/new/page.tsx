import { PageHeader } from "@/components/admin/page-header";
import { getSelectedAnnouncedCoupon, listCouponProductChoices } from "@/lib/data/coupons";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { createCouponAction } from "../actions";
import { CouponForm } from "../coupon-form";

export default async function NewCouponPage() {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const [products, announced] = await Promise.all([listCouponProductChoices(tenantId), getSelectedAnnouncedCoupon(tenantId)]);
  return <div className="grid gap-5"><PageHeader title={t("coupons.new.title")} description={t("coupons.new.description")} back={{ href: "/admin/discounts/coupons", label: t("coupons.page.title") }} /><CouponForm action={createCouponAction} products={products} submitLabel={t("coupons.form.create")} announcedCouponLabel={announced?.name || announced?.code || null} defaults={{ name: "", code: "", scope: "ORDER_SUBTOTAL", type: "PERCENTAGE", value: "10", isEnabled: true, startsAt: "", endsAt: "", isAnnounced: false, announcementText: "Use {code} at checkout", productIds: [] }} /></div>;
}
