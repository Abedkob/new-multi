import { notFound } from "next/navigation";
import { getTenantBySlug } from "@/lib/data/tenants";
import { requirePlatformAdmin } from "@/lib/session";
import { parseThemeOverrides } from "@/lib/theme";
import { TEMPLATE_IDS, TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";
import { ThemeEditor } from "./theme-editor";

/**
 * Platform admin only. Template, colors and a live preview of the whole storefront in one
 * place. Store owners manage content, products and section visibility instead.
 */
export default async function StoreThemePage({
  params,
}: PageProps<"/platform/stores/[slug]/theme">) {
  await requirePlatformAdmin();
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  return (
    <ThemeEditor
      slug={tenant.slug}
      storeName={tenant.name}
      templates={TEMPLATE_IDS.map((id) => ({
        id,
        label: TEMPLATE_META[id].label,
        description: TEMPLATE_META[id].description,
        defaults: TEMPLATE_META[id].defaults,
      }))}
      initialTemplate={normalizeTemplateId(tenant.templateId)}
      initialOverrides={parseThemeOverrides(tenant.themeOverrides)}
    />
  );
}
