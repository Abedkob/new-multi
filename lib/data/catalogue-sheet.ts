/**
 * The reads the catalogue sheet needs, and nothing else.
 *
 * `listCatalogueNames` is one indexed read of three small columns that does double duty: it fills
 * the template's hidden suggestion list, and it is also the name-match index and the taken-slug
 * set the importer allocates against. One read, three jobs — which is why the importer does not go
 * through `createProduct`, whose per-product slug loop re-reads the same thing once per row.
 */

import { withTenant } from "@/lib/prisma";

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
