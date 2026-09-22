import { notFound } from "next/navigation";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { getTemplate } from "@/templates";
import { CheckoutView } from "@/templates/checkout-view";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: PageProps<"/store/[slug]/checkout">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  return (
    <CheckoutView
      slug={slug}
      content={data.content}
      style={getTemplate(tenant.templateId).pageStyle}
    />
  );
}
