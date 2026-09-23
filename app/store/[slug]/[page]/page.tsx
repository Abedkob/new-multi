import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ContentKey } from "@/lib/content";
import { loadStorefrontData, loadTenant } from "@/lib/data/storefront";
import { isPageSlug } from "@/lib/pages";
import { pageMeta, plainText, storeImage } from "@/lib/seo";
import { getTemplate } from "@/templates";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/[page]">): Promise<Metadata> {
  const { slug, page } = await params;
  if (!isPageSlug(page)) return {};
  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) return {};
  const body = data.content[`${page}.body` as ContentKey]?.trim() || "";
  if (!body) return {};
  return pageMeta({
    tenant,
    path: `/${page}`,
    title: data.content[`${page}.title` as ContentKey],
    description: plainText(body),
    // Only some pages have their own image (e.g. about.image); fall back to the store's.
    images: [data.content[`${page}.image` as ContentKey] || storeImage(data.content)],
    type: "article",
  });
}

/**
 * About / Contact / FAQ / Shipping. A page exists only when its text is non-empty, so an
 * unwritten page is a 404 (and is never linked from the navbar or footer).
 */
export default async function ContentPage({ params }: PageProps<"/store/[slug]/[page]">) {
  const { slug, page } = await params;
  if (!isPageSlug(page)) notFound();

  const [tenant, data] = await Promise.all([loadTenant(slug), loadStorefrontData(slug)]);
  if (!tenant || !data) notFound();

  const body = data.content[`${page}.body` as ContentKey]?.trim() || "";
  if (!body) notFound();
  const title = data.content[`${page}.title` as ContentKey];
  const image = data.content[`${page}.image` as ContentKey];

  const s = getTemplate(tenant.templateId).pageStyle;
  // Plain text: blank lines separate paragraphs, single newlines stay as line breaks.
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <article className={s.container} data-testid="content-page">
      <h1 className={s.title}>{title}</h1>
      <div className="mt-8 max-w-4xl leading-relaxed">
        {image && (
          <img 
            src={image} 
            alt={title} 
            className="w-full md:w-1/2 md:float-right md:ml-8 mb-6 rounded-xl object-cover"
          />
        )}
        {paragraphs.map((p, i) => (
          <p key={i} className={i > 0 ? "whitespace-pre-line mt-5" : "whitespace-pre-line"}>
            {p}
          </p>
        ))}
        {image && <div className="clear-both" />}
      </div>
    </article>
  );
}
