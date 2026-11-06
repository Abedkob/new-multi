/**
 * Application-level tenant scoping, with Row-Level Security switched OFF
 * (pnpm verify:app-scoping).
 *
 * This is the twin of `verify:isolation`, and the two differ in exactly one thing: the database
 * role they connect as.
 *
 *   verify:isolation    runs as app_user (RLS live)      — a pass means "the two layers
 *                                                          together refuse"
 *   verify:app-scoping  runs as the owner (RLS inert)    — a pass means "the application's own
 *                                                          WHERE clauses refuse, alone"
 *
 * Why both exist. Every `lib/data/*.ts` function takes a `tenantId` and puts it in its WHERE,
 * and RLS independently filters the same rows. Run only as app_user and those two are
 * indistinguishable: delete `tenantId` from `getProduct`'s WHERE and Postgres removes the row
 * anyway, so all 18 isolation checks still pass. That was demonstrated, not assumed — the bug
 * was planted and the suite reported green.
 *
 * That matters on the day RLS is not there. `APP_DATABASE_URL` is optional and falls back to
 * `DATABASE_URL`; a restore onto a fresh machine has no `app_user` at all, because `pg_dump`
 * writes no `CREATE ROLE`; a migration console, a one-off script or a scheduled job may run as
 * the owner. In every one of those the application's WHERE clause is the only thing left, and
 * until this suite existed nothing had ever tested it on its own.
 *
 * The self-check is the point. A suite like this fails silently by becoming a duplicate of its
 * twin: connect as the restricted role by accident and every assertion still passes, proving
 * nothing new. So `assertPrivilegedRole` refuses to run unless the role really does bypass RLS,
 * and `assertRlsInert` proves it with a positive control — a cross-tenant read that MUST come
 * back, because if the database is still filtering then nothing below means anything.
 *
 * It covers the application-layer attacks only. The database-layer ones in `verify:isolation`
 * (the license row's policy, the WITH CHECK halves, the staff CHECK constraint) are about RLS
 * itself and are meaningless with it off; they stay there.
 */

import "dotenv/config";
// MUST come before anything that imports ../lib/prisma: it points APP_DATABASE_URL at the
// owner URL, and the client is built once, at import time, from whatever it says then.
import "./_owner";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../lib/prisma";
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
import { createCoupon, getCoupon, updateCoupon } from "../lib/data/coupons";
import { listSavedCampaigns, saveCampaign } from "../lib/data/campaigns";
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

/**
 * The inverse of verify:isolation's guard. There, a privileged role makes the suite vacuous;
 * here, a restricted one does.
 */
async function assertPrivilegedRole() {
  const [role] = await prisma.$queryRaw<
    { current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (!role) throw new Error("Could not determine the database role this script is connected as.");
  if (!role.rolsuper && !role.rolbypassrls) {
    throw new Error(
      `This suite must connect as a role that BYPASSES Row-Level Security, and it is connected ` +
        `as "${role.current_user}", which does not. Every assertion below would then be enforced ` +
        `by the database rather than by the application, and would pass without testing the thing ` +
        `this suite exists for. Check that ./_owner is imported before ../lib/prisma, and that ` +
        `DATABASE_URL points at the owner role.`,
    );
  }
  console.log(`Connected as ${role.current_user} (superuser=${role.rolsuper}, bypassrls=${role.rolbypassrls}).`);
}

/**
 * A positive control: with RLS off, a raw cross-tenant read MUST return the other store's row.
 * If it comes back empty the database is still filtering, so nothing this suite reports is
 * about the application — and a green run would be a lie rather than a weaker claim.
 */
async function assertRlsInert(tenantA: string, tenantB: string, productIdOfA: string) {
  const rows = await withTenant(tenantB, (db) =>
    db.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE id = ${productIdOfA}`,
  );
  assert.equal(
    rows.length,
    1,
    "RLS is still filtering: a raw read of store A's product from store B's context came back " +
      "empty. This suite cannot test application scoping while the database is doing it, so it " +
      "fails rather than reporting a pass it has not earned.",
  );
  void tenantA;
  console.log("RLS confirmed inert: a raw cross-tenant read returns the row.\n");
}

async function main() {
  await assertPrivilegedRole();

  const run = Date.now().toString(36);
  const a = await createStoreWithOwner({
    storeName: `Scope A ${run}`,
    ownerName: "A",
    ownerEmail: `scope-a-${run}@example.test`,
    passwordHash: "x",
  });
  const b = await createStoreWithOwner({
    storeName: `Scope B ${run}`,
    ownerName: "B",
    ownerEmail: `scope-b-${run}@example.test`,
    passwordHash: "x",
  });
  const A = a.tenant.id;
  const B = b.tenant.id;

  try {
    const pa = await createProduct(A, { name: "A widget", ...input });
    const pb = await createProduct(B, { name: "B widget", ...input });

    await assertRlsInert(A, B, pa.id);

    console.log("Store B attacking store A, with only the WHERE clause in the way:");

    await check("getProduct scopes by tenant", async () => {
      assert.equal(await getProduct(B, pa.id), null);
    });
    await check("getProductBySlug scopes by tenant", async () => {
      assert.equal(await getProductBySlug(B, pa.slug), null);
    });
    await check("listProducts scopes by tenant", async () => {
      assert.deepEqual((await listProducts(B)).map((p) => p.id), [pb.id]);
    });
    await check("updateProduct scopes by tenant", async () => {
      assert.equal(await updateProduct(B, pa.id, { name: "HACKED", ...input }), false);
      assert.equal((await getProduct(A, pa.id))?.name, "A widget");
    });
    await check("updateProduct cannot flip another store's best-seller flag", async () => {
      await updateProduct(B, pa.id, { name: "A widget", ...input, isBestSeller: true });
      assert.equal((await getProduct(A, pa.id))?.isBestSeller, false);
    });
    await check("deleteProduct scopes by tenant", async () => {
      assert.equal(await deleteProduct(B, pa.id), false);
      assert.ok(await getProduct(A, pa.id));
    });
    await check("saveContent writes only the caller's rows", async () => {
      await saveContent(B, [{ key: "hero.headline", value: "B headline" }]);
      const aRow = (await listContentRows(A)).find((r) => r.key === "hero.headline");
      assert.notEqual(aRow?.value, "B headline");
    });
    await check("listContentRows scopes by tenant", async () => {
      await saveContent(A, [{ key: "hero.subheadline", value: "A only" }]);
      const bRows = await listContentRows(B);
      assert.equal(bRows.find((r) => r.key === "hero.subheadline")?.value, undefined);
    });
    await check("discount reads, writes and assignments scope by tenant", async () => {
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
      assert.equal(
        await updateDiscount(B, discount.id, {
          name: "Hacked",
          type: "PERCENTAGE",
          value: 99,
          isEnabled: true,
          startsAt: null,
          endsAt: null,
        }),
        false,
      );
      assert.equal((await getDiscount(A, discount.id))!.name, "A only");
    });
    await check("coupon reads and writes scope by tenant", async () => {
      const baseCoupon = {
        name: "Private offer",
        code: `SCOPE${run.toUpperCase()}`,
        scope: "SELECTED_PRODUCTS" as const,
        type: "PERCENTAGE" as const,
        value: 10,
        isEnabled: true,
        startsAt: null,
        endsAt: null,
        isAnnounced: false,
        announcementText: null,
      };
      const couponA = await createCoupon(A, { ...baseCoupon, productIds: [pa.id] });
      assert.equal(await getCoupon(B, couponA.id), null);
      await assert.rejects(
        updateCoupon(B, couponA.id, {
          ...baseCoupon,
          code: "HACKED",
          productIds: [pb.id],
          revision: couponA.revision,
        }),
      );
      assert.equal((await getCoupon(A, couponA.id))?.code, baseCoupon.code);
    });
    await check("listSavedCampaigns scopes by tenant", async () => {
      await saveCampaign(A, {
        name: "A's Eid sale",
        utmCampaign: `a-eid-${run}`,
        channel: "instagram",
        destinationPath: "/shop",
      });
      assert.deepEqual(await listSavedCampaigns(B), [], "B must see none of A's campaigns");
    });
    await check("setSectionVisible writes only the caller's tenant", async () => {
      await setSectionVisible(B, "reviews", false);
      const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { id: A } });
      const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: B } });
      assert.equal(parseSectionVisibility(tenantA.sectionVisibility).reviews, true);
      assert.equal(parseSectionVisibility(tenantB.sectionVisibility).reviews, false);
    });

    console.log("\nSanity: a store can still reach its own data:");
    await check("A can read, rename and delete its own product", async () => {
      assert.equal(await updateProduct(A, pa.id, { name: "A renamed", ...input }), true);
      assert.equal((await getProduct(A, pa.id))?.name, "A renamed");
      assert.equal(await deleteProduct(A, pa.id), true);
      assert.equal(await getProduct(A, pa.id), null);
    });
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }

  console.log(`\nAll ${passed} application-scoping checks passed (RLS off).`);
}

main()
  .catch((e) => {
    console.error("\nAPPLICATION SCOPING CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
