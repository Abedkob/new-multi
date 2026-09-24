/**
 * Tenant-isolation check against the real database (pnpm verify:isolation).
 * Creates two throwaway stores, has store B try to read/modify/delete store A's
 * data through the same data-layer functions the admin actions use, then cleans up.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProductBySlug,
  listProducts,
  updateProduct,
} from "../lib/data/products";
import { listContentRows, saveContent } from "../lib/data/content";
import {
  createDiscount,
  getDiscount,
  setDiscountAssignmentsForProducts,
  updateDiscount,
} from "../lib/data/discounts";
import { setSectionVisible } from "../lib/data/sections";
import { parseSectionVisibility } from "../lib/sections";

const input = {
  description: "d",
  basePriceCents: 1000,
  imageUrl: "",
  images: [],
  isBestSeller: false,
  categoryId: null,
  variants: [{ attributes: {}, stock: 5, priceCentsOverride: null, imageUrl: null }],
};
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

async function main() {
  const run = Date.now().toString(36);
  const a = await createStoreWithOwner({
    storeName: `Iso A ${run}`,
    ownerName: "A",
    ownerEmail: `iso-a-${run}@example.test`,
    passwordHash: "x",
  });
  const b = await createStoreWithOwner({
    storeName: `Iso B ${run}`,
    ownerName: "B",
    ownerEmail: `iso-b-${run}@example.test`,
    passwordHash: "x",
  });
  const A = a.tenant.id;
  const B = b.tenant.id;

  try {
    const pa = await createProduct(A, { name: "A widget", ...input });
    const pb = await createProduct(B, { name: "B widget", ...input });

    console.log("Store B attacking store A:");
    await check("cannot read A's product by id", async () => {
      assert.equal(await getProduct(B, pa.id), null);
    });
    await check("cannot read A's product by slug (storefront lookup)", async () => {
      assert.equal(await getProductBySlug(B, pa.slug), null);
    });
    await check("A's product is absent from B's list", async () => {
      const ids = (await listProducts(B)).map((p) => p.id);
      assert.deepEqual(ids, [pb.id]);
    });
    await check("cannot update A's product", async () => {
      assert.equal(await updateProduct(B, pa.id, { name: "HACKED", ...input }), false);
      assert.equal((await getProduct(A, pa.id))?.name, "A widget");
    });
    await check("cannot delete A's product", async () => {
      assert.equal(await deleteProduct(B, pa.id), false);
      assert.ok(await getProduct(A, pa.id));
    });
    await check("content writes only touch the caller's tenant", async () => {
      await saveContent(B, [{ key: "hero.headline", value: "B headline" }]);
      const aRow = (await listContentRows(A)).find((r) => r.key === "hero.headline");
      assert.notEqual(aRow?.value, "B headline");
    });
    await check("same product name in both stores gets independent slugs", async () => {
      const dup = await createProduct(B, { name: "A widget", ...input });
      assert.equal(dup.slug, pa.slug);
      assert.notEqual(dup.tenantId, pa.tenantId);
    });

    await check("cannot flip A's best-seller flag", async () => {
      await updateProduct(B, pa.id, { name: "A widget", ...input, isBestSeller: true });
      assert.equal((await getProduct(A, pa.id))?.isBestSeller, false);
    });
    await check("discount campaigns and product assignments stay inside their store", async () => {
      const discount = await createDiscount(A, {
        name: "A only",
        type: "PERCENTAGE",
        value: 25,
        isEnabled: true,
        startsAt: null,
        endsAt: null,
      });
      await setDiscountAssignmentsForProducts(A, discount.id, [pa.id], [pa.id]);
      assert.equal(await getDiscount(B, discount.id), null);
      assert.equal(await updateDiscount(B, discount.id, {
        name: "Hacked",
        type: "PERCENTAGE",
        value: 99,
        isEnabled: true,
        startsAt: null,
        endsAt: null,
      }), false);
      await assert.rejects(
        setDiscountAssignmentsForProducts(B, discount.id, [pa.id], [pa.id]),
      );
      assert.equal((await getDiscount(A, discount.id))!.name, "A only");
    });
    await check("section visibility changes only touch the caller's tenant", async () => {
      await setSectionVisible(B, "reviews", false);
      const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { id: A } });
      const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: B } });
      assert.equal(parseSectionVisibility(tenantA.sectionVisibility).reviews, true);
      assert.equal(parseSectionVisibility(tenantB.sectionVisibility).reviews, false);
    });

    console.log("Sanity: owners can manage their own data:");
    await check("A can update and delete its own product", async () => {
      assert.equal(await updateProduct(A, pa.id, { name: "A renamed", ...input }), true);
      assert.equal((await getProduct(A, pa.id))?.name, "A renamed");
      assert.equal(await deleteProduct(A, pa.id), true);
      assert.equal(await getProduct(A, pa.id), null);
    });
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [a.user.id, b.user.id] } },
    });
  }
  console.log(`\nAll ${passed} isolation checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nISOLATION CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
