/**
 * Real-browser check of the catalogue import: a file chosen in a file input, the preview read off
 * the screen, Apply pressed, and the catalogue changed.
 *
 * `pnpm verify:import-ui` already walks these routes over HTTP and proves the capability split
 * with a real staff cookie. What only a browser can prove is the part a merchant actually touches:
 * that a chosen file reaches the action, that the verdicts render, that Apply writes, and that the
 * two downloads really download rather than 200 with an HTML error page in them.
 *
 * The mandatory custom-domain leg is at the end. Admin paths are platform-host only, and a leg
 * that cannot run must FAIL rather than quietly pass — see scripts/e2e/custom-domain.ts.
 */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildWorkbook } from "../../lib/catalogue-sheet/workbook";
import { readWorkbook } from "../../lib/catalogue-sheet/workbook";
import { createProduct } from "../../lib/data/products";
import { readCatalogueForExport } from "../../lib/data/catalogue-sheet";
import { setTenantStock } from "../../lib/data/tenants";
import { prisma, withTenant } from "../../lib/prisma";
import { describeStockDrift, findStockDrift } from "../../lib/stock/invariant";
import { parseAttributes } from "../../lib/variants";
import { en } from "../../lib/i18n/dictionaries/en";
import { BASE, launch, login, makeStore } from "./browser";
import { assertDevOriginAllowed, onCustomDomain, PRODUCTION_BUILD_HINT } from "./custom-domain";

const DOMAIN = "import-e2e.test";

async function main() {
  const store = await makeStore("Import");
  const T = store.tenant.id;
  const actor = { userId: store.user.id, name: "Import" };
  const { browser, context } = await launch();
  const page = await context.newPage();
  const work = mkdtempSync(join(tmpdir(), "import-e2e-"));
  let checks = 0;
  const ok = (message: string) => console.log(`  ok  ${++checks} ${message}`);

  try {
    await setTenantStock(T, store.user.id);
    const shirt = await createProduct(
      T,
      {
        name: "Linen Overshirt",
        description: "Garment-washed.",
        basePriceCents: 8_900,
        imageUrl: "/a.png",
        images: [{ url: "/a.png" }, { url: "/b.png" }, { url: "/c.png" }],
        isBestSeller: false,
        categoryId: null,
        variants: [
          { attributes: { Size: "M" }, stock: 4, priceCentsOverride: null, imageUrl: null },
          { attributes: { Size: "L" }, stock: 2, priceCentsOverride: null, imageUrl: null },
        ],
      },
      actor,
    );

    await login(page, store.user.email, store.password);

    // ---- the two downloads, checked as downloads -------------------------------------------
    await page.goto(`${BASE}/admin/products/import`);
    for (const [name, expected] of [
      [en["import.downloadTemplate"], "catalogue-template"],
      [en["import.exportCatalogue"], "catalogue"],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name }).click(),
      ]);
      const suggested = download.suggestedFilename();
      assert.ok(suggested.startsWith(expected), `${name} offered ${suggested}`);
      assert.ok(suggested.endsWith(".xlsx"), `${name} offered ${suggested}`);
      const path = join(work, suggested);
      await download.saveAs(path);
      // A route that 200s with an HTML error page would pass a status check and fail a merchant.
      const { sheets } = await readWorkbook(await (await import("node:fs/promises")).readFile(path));
      assert.deepEqual(Object.keys(sheets).sort(), ["products", "stock", "variants"], name);
    }
    ok("both downloads arrive as workbooks our own reader can open");

    // ---- a file a merchant would really upload ---------------------------------------------
    const data = await readCatalogueForExport(T);
    const upload = join(work, "edited.xlsx");
    writeFileSync(
      upload,
      await buildWorkbook({
        locale: "en",
        storeName: store.tenant.name,
        categoryPaths: data.categoryPaths,
        productNames: data.productNames,
        products: [
          { ...data.products[0], priceCents: 9_900 },
          {
            name: "Waxed Weekender",
            description: "Roomy.",
            priceCents: 14_800,
            categoryPath: ["Bags", "Duffels"],
            bestSeller: true,
            warnAt: 2,
          },
        ],
        // Only ONE of the two existing options, so the "kept" notice must appear.
        variants: [data.variants[0]],
      }),
    );

    await page.goto(`${BASE}/admin/products/import`);
    await page.setInputFiles('input[type="file"]', upload);
    await page.getByRole("button", { name: en["import.check"] }).click();
    await page.getByRole("button", { name: en["import.apply"] }).waitFor();
    ok("a chosen file reaches the action and comes back as a preview");

    const figure = async (label: string) =>
      Number(
        await page
          .locator("span", { has: page.locator(`span:text-is("${label}")`) })
          .first()
          .locator("span")
          .first()
          .innerText(),
      );
    assert.equal(await figure(en["import.willCreate"]), 1, "the new product");
    assert.equal(await figure(en["import.willUpdate"]), 1, "the repriced one");
    assert.equal(await figure(en["import.willRefuse"]), 0, "a clean file refuses no rows");
    // The created names, listed rather than counted: this list is the only place a merchant can
    // catch an accidental rename before it happens, which is the mitigation for matching by name.
    await page.getByText("Waxed Weekender", { exact: true }).waitFor();
    await page.getByText("Bags / Duffels", { exact: true }).waitFor();
    // And the option the file does not mention, said out loud.
    await page.getByText("Linen Overshirt — Size: L", { exact: true }).waitFor();
    ok("the preview names what it will create, and the option it is keeping");

    const before = await prisma.product.count({ where: { tenantId: T } });
    assert.equal(before, 1, "nothing may have been written by the preview");
    ok("the preview wrote nothing");

    await page.getByRole("button", { name: en["import.apply"] }).click();
    await page.getByText(en["import.reimportSafe"], { exact: false }).waitFor();
    ok("Apply reports what it did");

    const after = await withTenant(T, (db) =>
      db.product.findMany({
        where: { tenantId: T },
        orderBy: { name: "asc" },
        select: {
          name: true,
          basePriceCents: true,
          images: { select: { id: true } },
          variants: { select: { attributes: true, stock: true } },
        },
      }),
    );
    assert.deepEqual(after.map((p) => p.name), ["Linen Overshirt", "Waxed Weekender"]);
    const overshirt = after.find((p) => p.name === "Linen Overshirt")!;
    assert.equal(overshirt.basePriceCents, 9_900, "the price change landed");
    // The two things the first design of this feature would have destroyed.
    assert.equal(overshirt.images.length, 3, "all three photos must survive an update");
    assert.deepEqual(
      overshirt.variants.map((v) => [parseAttributes(v.attributes).Size, v.stock]).sort(),
      [["L", 2], ["M", 4]],
      "the option the file omitted must be kept, with its stock",
    );
    assert.equal(shirt.id, (await prisma.product.findFirstOrThrow({ where: { tenantId: T, name: "Linen Overshirt" } })).id, "and it must be the same product, not a new one");
    ok("the catalogue changed, and nothing the file left out was destroyed");

    const drift = await withTenant(T, (db) => findStockDrift(db, T));
    assert.equal(drift.length, 0, `the ledger and the shelf disagree — ${describeStockDrift(drift)}`);
    ok("the ledger still reconciles");

    // ---- the mandatory custom-domain leg ----------------------------------------------------
    assertDevOriginAllowed(DOMAIN);
    await prisma.tenant.update({ where: { id: T }, data: { domain: DOMAIN } });
    try {
      await onCustomDomain(DOMAIN, async ({ context: domainContext, origin }) => {
        const domainPage = await domainContext.newPage();
        // Prove the leg is really on the domain before asserting anything about it: a leg that
        // cannot show it reached the host proves nothing, whatever it then claims.
        const storefront = await domainPage.goto(origin);
        assert.equal(storefront?.status(), 200, `the storefront must answer on ${DOMAIN}`);
        assert.ok(
          (await domainPage.content()).includes(store.tenant.name),
          `${DOMAIN} must be serving this store, or ${PRODUCTION_BUILD_HINT}`,
        );

        for (const path of [
          "/admin/products/import",
          "/admin/products/import/template",
          "/admin/products/export",
          "/admin/stock/import",
          "/admin/stock/import/sheet",
        ]) {
          const res = await domainPage.goto(`${origin}${path}`);
          assert.equal(res?.status(), 404, `${path} answered ${res?.status()} on a store's own domain`);
        }
      });
      ok("every import path 404s on a store's own domain, and the storefront still answers");
    } finally {
      await prisma.tenant.update({ where: { id: T }, data: { domain: null } });
    }

    console.log(`\n${checks} import e2e checks passed.`);
  } finally {
    await browser.close();
    await store.remove();
  }
}

main()
  .catch((error) => {
    console.error("\nIMPORT E2E FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
