import { notFound } from "next/navigation";
import { CONTENT_KEYS, CONTENT_SECTIONS } from "@/lib/content";
import { listContentRows } from "@/lib/data/content";
import { getTenantById } from "@/lib/data/tenants";
import { parseSectionVisibility } from "@/lib/sections";
import { requireOwner } from "@/lib/session";
import { ContentEditor, type ContentSectionView } from "./content-editor";

/**
 * Store owner only. Every text field, grouped by storefront section, with a live preview
 * of the storefront next to it. Template and colors are not shown here.
 */
export default async function ContentPage() {
  const { tenantId } = await requireOwner();
  const [rows, tenant] = await Promise.all([
    listContentRows(tenantId),
    getTenantById(tenantId),
  ]);
  if (!tenant) notFound();

  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const sections: ContentSectionView[] = CONTENT_SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    optional: "optional" in s ? s.optional : undefined,
    fields: CONTENT_KEYS.filter((k) => k.section === s.id).map((k) => ({
      key: k.key,
      label: k.label,
      kind: k.kind,
      value: stored.get(k.key) ?? "",
      placeholder: k.default,
    })),
  }));

  return (
    <ContentEditor
      storeName={tenant.name}
      storeSlug={tenant.slug}
      sections={sections}
      initialVisibility={parseSectionVisibility(tenant.sectionVisibility)}
    />
  );
}
