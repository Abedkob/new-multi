import { PageHeader } from "@/components/admin/page-header";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { createDiscountAction } from "../actions";
import { DiscountForm } from "../discount-form";

export default async function NewDiscountPage() {
  await requireCapability("discounts:write");
  const t = await getT();
  return (
    <div className="grid">
      <PageHeader
        title={t("discounts.new.title")}
        back={{ href: "/admin/discounts", label: t("nav.discounts") }}
        description={t("discounts.new.description")}
      />
      <DiscountForm
        action={createDiscountAction}
        submitLabel={t("discounts.form.createSubmit")}
        defaults={{ name: "", type: "PERCENTAGE", value: "", isEnabled: false, startsAt: "", endsAt: "" }}
      />
    </div>
  );
}
