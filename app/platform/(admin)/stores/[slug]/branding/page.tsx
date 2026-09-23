import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Favicon</CardTitle>
        <CardDescription>
          The icon in the browser tab, bookmarks and history for this store. Only you can change
          it; the store owner doesn&apos;t see this setting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FaviconForm
          slug={tenant.slug}
          storeName={tenant.name}
          initial={tenant.faviconUrl}
          fallback={letterFavicon(tenant.name, colors.primaryColor)}
        />
      </CardContent>
    </Card>
  );
}
