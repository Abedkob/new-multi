import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { privatePageMeta } from "@/lib/seo";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { getTemplate } from "@/templates";
import { CartView } from "@/templates/cart-view";

export const dynamic = "force-dynamic";

// Never indexed (see lib/seo.ts privatePageMeta).
export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/cart">): Promise<Metadata> {
  const data = await loadStorefrontData((await params).slug);
  return privatePageMeta(data?.content["cart.heading"] || "Your cart");
}

export default async function CartPage({ params }: PageProps<"/store/[slug]/cart">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  return (
    <CartView
      slug={slug}
      basePath={data.store.basePath}
      content={data.content}
      deliveryFeeCents={tenant.deliveryFeeCents}
      deliveryNote={tenant.deliveryNote}
      style={getTemplate(tenant.templateId).pageStyle}
    />
  );
}
