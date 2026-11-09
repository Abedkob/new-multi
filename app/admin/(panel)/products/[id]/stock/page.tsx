import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { getProduct } from "@/lib/data/products";
import { getT } from "@/lib/i18n/locale";
import { requireCapability } from "@/lib/permissions";
import { parseAttributes, variantLabel } from "@/lib/variants";
import { StockForm } from "./stock-form";

/**
 * How many are on the shelf, and nothing else (D73, "products:stock").
 *
 * The one write surface in the catalogue that staff reach. It is a separate page from the
 * product form rather than a mode of it: the form posts the whole product, so a staff member
 * editing stock there would be sending a name, a price and an image set along with it, and no
 * permission check can tell whether those changed on purpose.
 */
export default async function ProductStockPage({ params }: PageProps<"/admin/products/[id]/stock">) {
  const { tenantId } = await requireCapability("products:stock");
  const t = await getT();
  const { id } = await params;

  // Scoped by tenantId: another store's product id is simply "not found".
  const product = await getProduct(tenantId, id);
  if (!product) notFound();

  const rows = product.variants.map((variant) => ({
    id: variant.id,
    label: variantLabel(parseAttributes(variant.attributes), t("products.variants.noOptions")),
    stock: variant.stock,
  }));

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("products.stock.title")}
        back={{ href: "/admin/products", label: t("nav.products") }}
        description={t("products.stock.description")}
      />
      <SectionCard title={product.name}>
        <StockForm rows={rows} />
      </SectionCard>
    </div>
  );
}
