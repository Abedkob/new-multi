import { notFound } from "next/navigation";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { getTemplate } from "@/templates";
import { HomeSections } from "@/templates/render";

export const dynamic = "force-dynamic";

export default async function StorePage({
  params,
}: PageProps<"/store/[slug]">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([
    loadTenant(slug),
    loadStorefrontData(slug),
  ]);
  if (!tenant || !data) notFound();

  return <HomeSections template={getTemplate(tenant.templateId)} data={data} />;
}
