/**
 * Tenant-isolation check against the real database (pnpm verify:isolation).
 * Creates two throwaway stores, has store B try to read/modify/delete store A's
 * data through the same data-layer functions the admin actions use, then cleans up.
 *
 * Runs as the RESTRICTED runtime role (APP_DATABASE_URL), not the owner. It used to import
 * ./_owner like the other scripts, which pointed it at the superuser - and a superuser bypasses
 * Row-Level Security entirely, so the whole suite was only ever exercising the application's own
 * WHERE clauses while reporting that isolation held. Connecting as the real runtime role means a
 * pass covers both layers at once.
 *
 * It refuses to run as a privileged role rather than passing vacuously; see assertRestrictedRole.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma, withBypass, withTenant } from "../lib/prisma";
import { createStoreWithOwner, getTenantBySlug } from "../lib/data/tenants";
import { canServeTenant } from "../lib/license/status";
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
import { createCoupon, getCoupon, updateCoupon } from "../lib/data/coupons";

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
 * Fail loudly when this would run as a superuser or a BYPASSRLS role. Passing in that state
 * would be worse than failing: it reports isolation as proven while the database layer of it is
 * switched off.
 */
async function assertRestrictedRole() {
  const [role] = await prisma.$queryRaw<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (!role) throw new Error("Could not determine the database role this script is connected as.");
  if (role.rolsuper || role.rolbypassrls) {
    const why = [role.rolsuper && "superuser", role.rolbypassrls && "BYPASSRLS"]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      [
        `Connected as "${role.current_user}", which bypasses Row-Level Security (${why}).`,
        "This check must run as the restricted runtime role, or it proves only half of what it claims.",
        "",
        '  1. Create the role:  psql -d <database> -v app_pw="<password>" -f scripts/sql/rls-role.sql',
        "  2. Point APP_DATABASE_URL at it in .env",
        "  3. Re-run: pnpm verify:isolation",
        "",
      ].join("\n"),
    );
  }
  console.log(`Connected as "${role.current_user}" (not superuser, not BYPASSRLS) - RLS is in force.`);
}

async function main() {
  await assertRestrictedRole();
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
    await check("coupon reads, edits, codes, and product assignments stay inside their store", async () => {
      const baseCoupon = {
        name: "Private offer", code: "SAMECODE", scope: "SELECTED_PRODUCTS" as const,
        type: "PERCENTAGE" as const, value: 10, isEnabled: true, startsAt: null, endsAt: null,
        isAnnounced: false, announcementText: null,
      };
      const couponA = await createCoupon(A, { ...baseCoupon, productIds: [pa.id] });
      await createCoupon(B, { ...baseCoupon, productIds: [pb.id] });
      assert.equal(await getCoupon(B, couponA.id), null);
      await assert.rejects(updateCoupon(B, couponA.id, { ...baseCoupon, code: "HACKED", productIds: [pb.id], revision: couponA.revision }));
      await assert.rejects(createCoupon(B, { ...baseCoupon, code: "CROSSPRODUCT", productIds: [pa.id] }));
      assert.equal((await getCoupon(A, couponA.id))?.code, "SAMECODE");
    });
    await check("section visibility changes only touch the caller's tenant", async () => {
      await setSectionVisible(B, "reviews", false);
      const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { id: A } });
      const tenantB = await prisma.tenant.findUniqueOrThrow({ where: { id: B } });
      assert.equal(parseSectionVisibility(tenantA.sectionVisibility).reviews, true);
      assert.equal(parseSectionVisibility(tenantB.sectionVisibility).reviews, false);
    });

    await check("cannot read another store's license row", async () => {
      await withBypass((db) =>
        db.tenantLicense.create({
          data: {
            tenantId: A,
            productCode: "test",
            licenseKeyCiphertext: "ciphertext",
            keyHint: "AAAA",
            status: "LICENSE_ACTIVE",
          },
        }),
      );
      const seen = await withTenant(B, (db) =>
        db.tenantLicense.findUnique({ where: { tenantId: A } }),
      );
      assert.equal(seen, null);
      assert.deepEqual(await withTenant(B, (db) => db.tenantLicense.findMany()), []);
    });
    await check("cannot write another store's license row", async () => {
      // The USING half: an update aimed at A's row from B's context matches nothing.
      const touched = await withTenant(B, (db) =>
        db.tenantLicense.updateMany({ where: { tenantId: A }, data: { status: "HACKED" } }),
      );
      assert.equal(touched.count, 0);
      // The WITH CHECK half, which a working USING clause alone would not cover: writing a row
      // that belongs to another store is refused outright, not silently hidden. B has no
      // license row, so a unique-constraint violation can't stand in for the policy here.
      await assert.rejects(
        withTenant(A, (db) =>
          db.tenantLicense.create({
            data: { tenantId: B, productCode: "test", licenseKeyCiphertext: "ciphertext" },
          }),
        ),
        /row-level security|violates/i,
      );
      const after = await withBypass((db) =>
        db.tenantLicense.findUniqueOrThrow({ where: { tenantId: A }, select: { status: true } }),
      );
      assert.equal(after.status, "LICENSE_ACTIVE");
      assert.equal(await withBypass((db) => db.tenantLicense.count({ where: { tenantId: B } })), 0);
    });
    await check("an expired license still stops the store serving", async () => {
      // The reason RLS on TenantLicense needed a code change as well: getTenantBySlug resolves a
      // store by slug with no tenant context, so an `include` would come back null for every
      // store — and isLicenseActive(null) is true by design during the opt-in rollout. Were that
      // regression to return, this check fails here rather than in production, silently.
      const past = new Date(Date.now() - 60_000);
      await withBypass((db) =>
        db.tenantLicense.update({ where: { tenantId: A }, data: { expiresAt: past } }),
      );
      const expired = await getTenantBySlug(a.tenant.slug);
      assert.ok(expired?.license, "the license must be readable without a tenant context set");
      assert.equal(expired.license.status, "LICENSE_ACTIVE");
      assert.equal(canServeTenant(expired), false);

      const future = new Date(Date.now() + 60 * 60_000);
      await withBypass((db) =>
        db.tenantLicense.update({ where: { tenantId: A }, data: { expiresAt: future } }),
      );
      const live = await getTenantBySlug(a.tenant.slug);
      assert.equal(canServeTenant(live!), true);
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
