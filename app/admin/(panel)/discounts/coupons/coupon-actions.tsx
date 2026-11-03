import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/locale";
import { archiveCouponAction, restoreCouponAction, setCouponEnabledAction } from "./actions";

export async function CouponActions({ id, code, archived, enabled }: { id: string; code: string; archived: boolean; enabled: boolean }) {
  const t = await getT();
  if (archived) return <form action={restoreCouponAction.bind(null, id)}><Button type="submit" variant="outline" size="sm">{t("coupons.actions.restore")}</Button></form>;
  return <div className="flex flex-wrap justify-end gap-2">
    <Link href={`/admin/discounts/coupons/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("common.edit")}</Link>
    <form action={setCouponEnabledAction.bind(null, id, !enabled)}><Button type="submit" variant="outline" size="sm">{enabled ? t("coupons.actions.disable") : t("coupons.actions.enable")}</Button></form>
    <form action={archiveCouponAction.bind(null, id)}><ConfirmSubmitButton size="sm" variant="ghost" title={t("coupons.actions.archiveTitle")} description={t("coupons.actions.archiveDescription").replace("{code}", code)} confirmLabel={t("coupons.actions.archive")}>{t("coupons.actions.archive")}</ConfirmSubmitButton></form>
  </div>;
}
