import { SectionCard } from "@/components/admin/section-card";
import { letterFavicon } from "@/lib/favicon";
import { parseThemeOverrides, resolveTheme } from "@/lib/theme";
import { TEMPLATE_META, normalizeTemplateId } from "@/templates/meta";
import { loadStore } from "../load";
import { FaviconForm } from "./favicon-form";

/** Platform admin only: store owners can't change the favicon, like the template and colors. */
export default async function StoreBrandingPage({
  params,
}: PageProps<"/platform/stores/[slug]/branding">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const colors = resolveTheme(
    TEMPLATE_META[normalizeTemplateId(tenant.templateId)].defaults,
    parseThemeOverrides(tenant.themeOverrides),
  );

  return (
    <SectionCard
      title="Favicon"
      description="The icon in the browser tab, bookmarks and history for this store. Only you can change it; the store owner doesn't see this setting."
    >
      <FaviconForm
        slug={tenant.slug}
        storeName={tenant.name}
        initial={tenant.faviconUrl}
        fallback={letterFavicon(tenant.name, colors.primaryColor)}
      />
    </SectionCard>
  );
}
