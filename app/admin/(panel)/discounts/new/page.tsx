import { PageHeader } from "@/components/admin/page-header";
import { requireOwner } from "@/lib/session";
import { createDiscountAction } from "../actions";
import { DiscountForm } from "../discount-form";

export default async function NewDiscountPage() {
  await requireOwner();
  return (
    <div className="grid">
      <PageHeader
        title="New discount"
        back={{ href: "/admin/discounts", label: "Discounts" }}
        description="Set the discount and schedule first. You will choose products after saving."
      />
      <DiscountForm
        action={createDiscountAction}
        submitLabel="Create discount"
        defaults={{ name: "", type: "PERCENTAGE", value: "", isEnabled: false, startsAt: "", endsAt: "" }}
      />
    </div>
  );
}
