/** Real-browser check of /admin/categories (pnpm e2e:categories; server must be running). */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { BASE, launch, login, makeStore } from "./browser";

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
        name: tr.querySelector("td")!.textContent!.replace(/[└\s]+/g, " ").trim(),
        indent: (tr.querySelector("td span") as HTMLElement).style.paddingLeft,
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

    // Deleting Men is blocked and nothing is deleted.
    page.once("dialog", (d) => d.accept());
    await page.locator("tbody tr", { hasText: "Men" }).first().getByRole("button", { name: "Delete" }).click();
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
      page.once("dialog", (d) => d.accept());
      await page.locator("tbody tr", { hasText: name }).first().getByRole("button", { name: "Delete" }).click();
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
