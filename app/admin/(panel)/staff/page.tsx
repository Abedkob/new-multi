import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { listStaffAccounts } from "@/lib/data/staff";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { StaffManager } from "./staff-manager";

/**
 * The owner's own staff list (D71, D73).
 *
 * The screen says plainly what a staff account can and cannot do, because the owner is handing
 * somebody their customers' names, phone numbers and addresses and should know that before they
 * create the account — not discover it from a support conversation afterwards.
 */
export default async function StaffPage() {
  const { tenantId } = await requireCapability("staff:manage");
  const t = await getT();
  const staff = await listStaffAccounts(tenantId);

  return (
    <div className="grid gap-4">
      <PageHeader title={t("nav.staff")} description={t("staff.page.description")} />

      <SectionCard title={t("staff.what.title")} data-testid="staff-scope">
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>{t("staff.what.can")}</p>
          <p>{t("staff.what.cannot")}</p>
        </div>
      </SectionCard>

      <StaffManager
        staff={staff.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          mustChangePassword: member.mustChangePassword,
          createdAt: member.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
