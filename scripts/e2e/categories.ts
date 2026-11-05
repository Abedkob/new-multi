/** Real-browser check of /admin/categories (pnpm e2e:categories; server must be running). */
import "dotenv/config";
import "../_owner";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { createProduct } from "../../lib/data/products";
import { BASE, launch, login, makeStore } from "./browser";
import { assertDevOriginAllowed, onCustomDomain } from "./custom-domain";

const norm = (s: string) => s.replace(/[\s └]+/g, " ").trim();

async function main() {
  const store = await makeStore("Cat UI");
  const { browser, context } = await launch();
  const page = await context.newPage();
  let n = 0;
  const ok = (m: string) => console.log(`  ok  ${++n} ${m}`);

  try {
    await login(page, store.user.email, store.password);
    await page.goto(`${BASE}/admin/categories`);
    assert.ok(await page.getByText("No categories yet.").isVisible());
    ok("empty state on a new store");

    const create = async (name: string, parentName?: string) => {
      await page.goto(`${BASE}/admin/categories/new`);
      await page.fill("#name", name);
      if (parentName) {
        const value = await page
          .locator("#parentId option")
          .evaluateAll(
            (opts, label) =>
              (opts as HTMLOptionElement[]).find(
                (o) => o.textContent!.replace(/[\s └]+/g, " ").trim() === label,
              )?.value,
            parentName,
          );
        assert.ok(value, `parent option "${parentName}" not found`);
        await page.selectOption("#parentId", value!);
      }
      await Promise.all([
        page.waitForURL(`${BASE}/admin/categories`),
        page.click('button:has-text("Create category")'),
      ]);
    };

    await create("Men");
    await create("Shoes", "Men");
    await create("Nike", "Shoes");
    await create("Women");
    ok("created Men > Shoes > Nike and Women through the form");

    const rows = await page.locator("tbody tr").evaluateAll((trs) =>
      trs.map((tr) => ({
        depth: Number(tr.getAttribute("data-depth")),
        name: tr.querySelector('[data-testid="category-name"]')!.textContent!.trim(),
        // The indent is a LOGICAL inline style (paddingInlineStart), not paddingLeft: the admin
        // renders in Arabic too, where the tree has to indent from the right. Reading
        // paddingLeft here returned "" for every row and said nothing about the nesting.
        indent: (tr.querySelector("td span") as HTMLElement).style.paddingInlineStart,
      })),
    );
    assert.deepEqual(
      rows.map((r) => `${r.depth}:${r.name}`),
      ["0:Men", "1:Shoes", "2:Nike", "0:Women"],
    );
    assert.deepEqual(
      rows.map((r) => r.indent),
      ["0rem", "1.5rem", "3rem", "0rem"],
    );
    ok("tree renders with correct nesting and indentation");

    // ------------------------------------------- the tree's public face, on the store's own
    // domain. Mandatory since 2026-11-04 (scripts/e2e/custom-domain.ts): a leg that cannot run
    // FAILS.
    //
    // A category tree is built in the admin and spent on the storefront, and the storefront is
    // where the host matters: on a domain every link loses its /store/<slug> prefix
    // (getStoreBasePath), so a chip or breadcrumb built the other way 404s. The admin half of
    // this feature has no custom-domain behaviour to test — it has the opposite, which is
    // checked below: it must not be reachable from a store's domain at all, even by the owner.
    const domain = "categories-e2e.test";
    assertDevOriginAllowed(domain);
    const nike = await prisma.category.findFirstOrThrow({
      where: { tenantId: store.tenant.id, name: "Nike" },
    });
    await createProduct(store.tenant.id, {
      name: "Deep Shoe",
      description: "Filed three levels down, under Nike",
      basePriceCents: 9000,
      imageUrl: "",
      images: [],
      isBestSeller: false,
      categoryId: nike.id,
      variants: [{ attributes: {}, stock: 3, priceCentsOverride: null, imageUrl: null }],
    });
    // The owner's own session, replayed against their store's domain. Without this the 404s
    // below would prove only that an anonymous visitor is refused, which is not the claim.
    const ownerCookies = (await context.cookies(BASE))
      .filter((c) => c.name.includes("authjs") || c.name.includes("next-auth"))
      .map((c) => ({ ...c, domain, path: "/", sameSite: "Lax" as const }));
    assert.ok(ownerCookies.length > 0, "the owner must be logged in for this leg to mean anything");
    await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain } });
    try {
      await onCustomDomain(domain, async ({ context: domainContext, origin }) => {
        await domainContext.addCookies(ownerCookies);
        const d = await domainContext.newPage();
        const host = new URL(origin).host;

        // A parent category shows everything underneath it, three levels down included.
        await d.goto(`${origin}/category/men`, { waitUntil: "load" });
        await d.locator('[data-testid="catalog-page"]').waitFor();
        assert.match(
          await d.locator('[data-testid="catalog-page"]').innerText(),
          /Deep Shoe/,
          "a parent category must still show a product filed under its grandchild",
        );

        // The chips are the tree as a shopper sees it, and on a domain they are root-relative.
        const chips = await d.locator('[data-testid="category-chips"] a').evaluateAll((as) =>
          (as as HTMLAnchorElement[]).map((a) => a.getAttribute("href")),
        );
        assert.ok(chips.length > 0, "Men has a subcategory, so it must offer chips");
        for (const href of chips) {
          assert.ok(
            href?.startsWith("/category/"),
            `on a domain a category link must be root-relative, got ${href}`,
          );
        }
        await Promise.all([
          d.waitForURL(/\/category\/shoes$/),
          d.locator('[data-testid="category-chips"] a', { hasText: "Shoes" }).click(),
        ]);
        assert.equal(new URL(d.url()).host, host);
        assert.match(await d.locator('[data-testid="catalog-page"]').innerText(), /Deep Shoe/);
        ok(`on ${domain} a category page descends the tree and its chips are root-relative`);

        // And the admin tree itself is not reachable here, with the owner's own cookie attached.
        for (const path of ["/admin/categories", "/admin/categories/new", "/admin"]) {
          assert.equal(
            (await d.goto(`${origin}${path}`))?.status(),
            404,
            `${path} must be a 404 from a store's own domain, even for the logged-in owner`,
          );
        }
        ok(`on ${domain} the owner's own session does not open /admin — the console is a 404`);
      });
    } finally {
      await prisma.tenant.update({ where: { id: store.tenant.id }, data: { domain: null } });
      await prisma.product.deleteMany({ where: { tenantId: store.tenant.id } });
    }

    // Deleting Men is blocked and nothing is deleted.
    await page.locator("tbody tr", { hasText: "Men" }).first().getByRole("button", { name: "Delete" }).click();
    await page.getByTestId("confirm-dialog-confirm").click();
    const err = page.getByRole("alert").filter({ hasText: "Men" });
    await err.waitFor();
    assert.match((await err.textContent())!, /"Men" has 1 subcategory\. Move or delete it first\./);
    assert.equal(await page.locator("tbody tr").count(), 4);
    ok("deleting a category with children shows a clear error and deletes nothing");

    // Editing Men: the parent dropdown must not offer Men itself or anything below it.
    await page.locator("tbody tr", { hasText: "Men" }).first().getByRole("link", { name: "Edit" }).click();
    await page.waitForSelector("#parentId");
    const labels = (await page.locator("#parentId option").allTextContents()).map(norm);
    assert.deepEqual(labels, ["None (top level)", "Women"]);
    ok("edit form's parent dropdown excludes the category and its descendants");

    // Bottom-up deletion works.
    for (const name of ["Nike", "Shoes", "Men", "Women"]) {
      await page.goto(`${BASE}/admin/categories`);
      const before = await page.locator("tbody tr").count();
      await page.locator("tbody tr", { hasText: name }).first().getByRole("button", { name: "Delete" }).click();
      await page.getByTestId("confirm-dialog-confirm").click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll("tbody tr").length !== count ||
          document.body.innerText.includes("No categories yet."),
        before,
      );
    }
    await page.goto(`${BASE}/admin/categories`);
    assert.ok(await page.getByText("No categories yet.").isVisible());
    ok("leaf-first deletion works");

    await prisma.category.createMany({
      data: Array.from({ length: 80 }, (_, index) => {
        const number = String(index + 1).padStart(3, "0");
        return {
          tenantId: store.tenant.id,
          name: `Paged ${number}`,
          slug: `paged-${number}`,
        };
      }),
    });
    await page.goto(`${BASE}/admin/categories`);
    assert.equal(await page.locator("tbody tr").count(), 25);
    assert.equal(await page.getByTestId("admin-visible-range").innerText(), "Showing 1–25 of 80 categories");
    await page.getByLabel("Categories per page").selectOption("50");
    await page.waitForURL(/perPage=50/);
    assert.equal(await page.locator("tbody tr").count(), 50);
    await Promise.all([
      page.waitForURL(/page=2/),
      page.getByRole("link", { name: /Next/ }).click(),
    ]);
    assert.equal(await page.locator("tbody tr").count(), 30);
    assert.equal(await page.getByTestId("admin-visible-range").innerText(), "Showing 51–80 of 80 categories");
    await page.getByLabel("Categories per page").selectOption("75");
    await page.waitForURL((url) => url.searchParams.get("perPage") === "75" && !url.searchParams.has("page"));
    assert.equal(await page.locator("tbody tr").count(), 75);
    assert.equal(await page.getByTestId("admin-visible-range").innerText(), "Showing 1–75 of 80 categories");
    ok("25, 50 and 75 per-page options paginate and reset to page 1 when changed");

    // Cross-store: another store's category is a 404 at the edit URL.
    const other = await makeStore("Cat Other");
    try {
      const cat = await prisma.category.create({
        data: { tenantId: other.tenant.id, name: "Secret", slug: "secret" },
      });
      const res = await page.goto(`${BASE}/admin/categories/${cat.id}/edit`);
      assert.equal(res?.status(), 404);
      ok("another store's category id is a 404");
    } finally {
      await other.remove();
    }
  } finally {
    await browser.close();
    await store.remove();
  }
  console.log(`\nAll ${n} category UI checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nE2E FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
