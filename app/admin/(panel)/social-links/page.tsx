import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { getTenantById } from "@/lib/data/tenants";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { SOCIAL_LINK_FIELDS, socialLinksFromStore } from "@/lib/social-links";
import { SocialLinksForm } from "./social-links-form";

export default async function SocialLinksPage() {
  const { tenantId } = await requireOwner();
  const t = await getT();
  const tenant = await getTenantById(tenantId);
  if (!tenant) notFound();
  const links = socialLinksFromStore(tenant);

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("nav.socialLinks")}
        description={t("socialLinks.page.description")}
      />
      <SocialLinksForm
        defaults={Object.fromEntries(
          SOCIAL_LINK_FIELDS.map(({ key }) => [key, links[key] ?? ""]),
        ) as Record<(typeof SOCIAL_LINK_FIELDS)[number]["key"], string>}
      />
    </div>
  );
}
