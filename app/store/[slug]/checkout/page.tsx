import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { privatePageMeta } from "@/lib/seo";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { getTemplate } from "@/templates";
import { CheckoutView } from "@/templates/checkout-view";

export const dynamic = "force-dynamic";

// Never indexed (see lib/seo.ts privatePageMeta).
export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/checkout">): Promise<Metadata> {
  const data = await loadStorefrontData((await params).slug);
  return privatePageMeta(data?.content["checkout.heading"] || "Checkout");
}

export default async function CheckoutPage({ params }: PageProps<"/store/[slug]/checkout">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  return (
    <CheckoutView
      slug={slug}
      basePath={data.store.basePath}
      content={data.content}
      style={getTemplate(tenant.templateId).pageStyle}
    />
  );
}
