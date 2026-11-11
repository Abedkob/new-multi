/**
 * The reads the catalogue sheet needs, and nothing else.
 *
 * `listCatalogueNames` is one indexed read of three small columns that does double duty: it fills
 * the template's hidden suggestion list, and it is also the name-match index and the taken-slug
 * set the importer allocates against. One read, three jobs — which is why the importer does not go
 * through `createProduct`, whose per-product slug loop re-reads the same thing once per row.
 */

import { flattenCategories } from "@/lib/categories";
import type {
  ExportProduct,
  ExportStockLine,
  ExportVariant,
} from "@/lib/catalogue-sheet/workbook";
import { listCategories } from "@/lib/data/categories";
import { withTenant } from "@/lib/prisma";
import { parseAttributes } from "@/lib/variants";

export type CatalogueName = { id: string; name: string; slug: string };

export function listCatalogueNames(tenantId: string): Promise<CatalogueName[]> {
  return withTenant(tenantId, (db) =>
    db.product.findMany({
      where: { tenantId },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  );
}

/**
 * The whole catalogue, in the shape the workbook writer wants.
 *
 * One read with variants and images, plus the category tree for the paths. Shared by the catalogue
 * export (`products:write`) and the count-sheet export (`stock:move`), which take different slices
 * of it — so the two downloads can never disagree about what a product's figures are.
 *
 * **The field names here are load-bearing**, which is not a sentence one normally writes. The
 * columns are `basePriceCents` and `priceCentsOverride`; reading them as `priceCents` is a mistake
 * the compiler cannot catch through an object literal that is structurally fine, and it happened
 * twice while this feature was being built. `money()` in the workbook writer throws on the first
 * one now. The second — an optional column exported as blank — is caught only by the round-trip
 * leg in `pnpm verify:import`, because blank is a legal value that means "leave it alone".
 */
export async function readCatalogueForExport(tenantId: string) {
  const [rows, categories] = await Promise.all([
    withTenant(tenantId, (db) =>
      db.product.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
        select: {
          name: true,
          description: true,
          basePriceCents: true,
          isBestSeller: true,
          lowStockThreshold: true,
          categoryId: true,
          variants: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { attributes: true, stock: true, priceCentsOverride: true },
          },
        },
      }),
    ),
    listCategories(tenantId),
  ]);

  const flat = flattenCategories(categories);
  const pathById = new Map(flat.map((category) => [category.id, category.path]));

  const products: ExportProduct[] = rows.map((row) => ({
    name: row.name,
    description: row.description ?? "",
    priceCents: row.basePriceCents,
    categoryPath: row.categoryId ? (pathById.get(row.categoryId)?.split(" / ") ?? null) : null,
    bestSeller: row.isBestSeller,
    warnAt: row.lowStockThreshold,
  }));
  const variants: ExportVariant[] = rows.flatMap((row) =>
    row.variants.map((variant) => ({
      productName: row.name,
      attributes: parseAttributes(variant.attributes),
      stock: variant.stock,
      priceOverrideCents: variant.priceCentsOverride,
    })),
  );
  const stock: ExportStockLine[] = variants.map((variant) => ({
    productName: variant.productName,
    attributes: variant.attributes,
    onHand: variant.stock,
  }));

  return {
    products,
    variants,
    stock,
    categoryPaths: flat.map((category) => category.path),
    productNames: products.map((product) => product.name),
  };
}
