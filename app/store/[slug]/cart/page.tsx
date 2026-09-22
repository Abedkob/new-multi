import { notFound } from "next/navigation";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { getTemplate } from "@/templates";
import { CartView } from "@/templates/cart-view";

export const dynamic = "force-dynamic";

export default async function CartPage({ params }: PageProps<"/store/[slug]/cart">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  return (
    <CartView slug={slug} content={data.content} style={getTemplate(tenant.templateId).pageStyle} />
  );
}
