import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { absoluteUrl, jsonLd, pageMeta, storeDescription, storeImage } from "@/lib/seo";
import { getStoreUrl } from "@/lib/store-url";
import { getTemplate } from "@/templates";
import { HomeSections } from "@/templates/render";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) return {};
  return pageMeta({
    tenant,
    path: "",
    description: storeDescription(tenant.name, data.content),
    images: [storeImage(data.content)],
  });
}

export default async function StorePage({
  params,
}: PageProps<"/store/[slug]">) {
  const { slug } = await params;
  const [tenant, data] = await Promise.all([
    loadTenant(slug),
    loadStorefrontData(slug),
  ]);
  if (!tenant || !data) notFound();

  const url = getStoreUrl(tenant);
  const logo = data.content["navbar.logo"]?.trim();
  // WebSite tells Google the site's name (shown above results); Organization ties the logo to it.
  const structured = [
    { "@context": "https://schema.org", "@type": "WebSite", name: tenant.name, url },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: tenant.name,
      url,
      ...(logo ? { logo: absoluteUrl(tenant, logo) } : {}),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <HomeSections template={getTemplate(tenant.templateId)} data={data} />
    </>
  );
}
