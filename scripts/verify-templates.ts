/**
 * Template + section check (pnpm verify:templates). Needs the server running
 * (BASE_URL, default http://localhost:3000) and the demo store (pnpm demo:seed).
 *
 * For every template it verifies that:
 *  - all 11 sections render, in the canonical order, with the store's real content
 *  - New arrivals / Best sellers show the right products
 *  - each of the 4 optional sections disappears when switched off and comes back
 *    (with its content intact) when switched on
 *  - switching templates changes no content, product or visibility data
 *  - template colors are injected as CSS variables and hostile theme JSON is ignored
 * It also statically checks that templates only use canonical content keys and never
 * hardcode colors. The store's original settings are restored at the end.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { CONTENT_KEY_NAMES, fillTokens, resolveContent } from "../lib/content";
import { createStoreWithOwner } from "../lib/data/tenants";
import { hashPassword } from "../lib/passwords";
import { setSectionVisible } from "../lib/data/sections";
import { toStoreProduct } from "../lib/store-product";
import { saveThemeOverrides, setTenantTemplate } from "../lib/data/theme";
import { OPTIONAL_SECTIONS, SECTION_ORDER, type OptionalSection } from "../lib/sections";
import { TEMPLATE_IDS, TEMPLATE_META, normalizeTemplateId } from "../templates/meta";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SLUG = process.env.STORE_SLUG ?? "demo-boutique";

const decode = (html: string) =>
  html
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

async function page(path: string) {
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 200, `${path} -> ${res.status}`);
  return decode((await res.text()).replaceAll(/<!--.*?-->/g, ""));
}

const sectionsIn = (html: string) =>
  [...html.matchAll(/data-section="(\w+)"/g)].map((m) => m[1]);

/** HTML belonging to one section (up to the next section wrapper). */
function chunk(html: string, id: string) {
  const start = html.indexOf(`data-section="${id}"`);
  if (start < 0) return "";
  const next = html.indexOf('data-section="', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}

/** Every non-empty line of a (possibly multi-line) value must appear. */
const lines = (v: string) => v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
function assertShows(html: string, value: string, where: string) {
  for (const line of lines(value)) {
    assert.ok(html.includes(line), `${where} is missing "${line}"`);
  }
}

async function fingerprint(tenantId: string) {
  const [products, content, tenant] = await Promise.all([
    prisma.product.findMany({ where: { tenantId }, orderBy: { id: "asc" } }),
    prisma.tenantContent.findMany({ where: { tenantId }, orderBy: { key: "asc" } }),
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { sectionVisibility: true },
    }),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ products, content, vis: tenant.sectionVisibility }))
    .digest("hex");
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log(`  ok  ${name}`);
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function staticChecks() {
  console.log("Static checks on templates/:");
  const files = walk("templates").filter((f) => f.endsWith(".tsx"));
  const used = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/content\["([^"]+)"\]/g)) used.add(m[1]);
  }
  const unknown = [...used].filter((k) => !CONTENT_KEY_NAMES.includes(k));
  assert.deepEqual(unknown, [], `templates use non-canonical content keys: ${unknown}`);
  ok(`all ${used.size} content keys used by templates are canonical`);

  // (?<!&): an HTML entity like &#9733; (a star) isn't a hex color.
  const colorLiteral =
    /(?<!&)#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|shadow|accent|outline|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\b/;
  for (const f of files) {
    const hit = readFileSync(f, "utf8").match(colorLiteral);
    assert.ok(!hit, `${f} hardcodes a color: ${hit?.[0]}`);
  }
  ok("no template component hardcodes a color");

  for (const id of TEMPLATE_IDS) {
    const src = readFileSync(`templates/${id}/index.tsx`, "utf8");
    for (const s of [
      "Announcement", "Navbar", "Hero", "FeaturedCategories", "NewArrivals", "BestSellers",
      "PromoBanner", "BrandStory", "Reviews", "Instagram", "Footer", "ProductPage",
    ]) {
      assert.ok(new RegExp(`const ${s}\\b`).test(src), `${id} does not implement ${s}`);
    }
  }
  ok("every template implements all 11 sections + the product page");
}

async function main() {
  staticChecks();

  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`Store "${SLUG}" not found. Run pnpm demo:seed first.`);
  const original = {
    templateId: tenant.templateId,
    overrides: tenant.themeOverrides,
    visibility: tenant.sectionVisibility,
  };

  const setAllVisible = async () => {
    for (const s of OPTIONAL_SECTIONS) await setSectionVisible(tenant.id, s, true);
  };

  try {
    await setAllVisible();
    await saveThemeOverrides(tenant.id, {});

    const [products, rows] = await Promise.all([
      prisma.product
        .findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, include: { variants: true, images: true } })
        .then((rows) => rows.map(toStoreProduct)),
      prisma.tenantContent.findMany({ where: { tenantId: tenant.id } }),
    ]);
    const c = resolveContent(rows);
    const best = products.filter((p) => p.isBestSeller);
    const notBest = products.filter((p) => !p.isBestSeller);
    assert.ok(best.length >= 2 && notBest.length >= 1, "demo store needs best sellers and non-best-sellers");
    const before = await fingerprint(tenant.id);
    const detail = products[0];

    const optionalContent: Record<OptionalSection, { section: string; probe: string }> = {
      announcementBar: { section: "announcement", probe: c["announcement.text"] },
      heroText: { section: "hero", probe: c["hero.headline"] },
      promoBanner: { section: "promoBanner", probe: c["promoBanner.heading"] },
      brandStory: { section: "brandStory", probe: c["brandStory.heading"] },
      reviews: { section: "reviews", probe: c["reviews.item1.quote"] },
    };
    for (const [k, v] of Object.entries(optionalContent)) {
      assert.ok(v.probe, `demo content for ${k} is empty; run pnpm demo:seed`);
    }

    for (const id of TEMPLATE_IDS) {
      console.log(`Template "${id}":`);
      await setTenantTemplate(tenant.id, id);
      const home = await page(`/store/${SLUG}`);

      assert.deepEqual(sectionsIn(home), [...SECTION_ORDER], `${id}: sections missing or out of order`);
      ok("all 11 sections render in the canonical order");

      for (const key of [
        "navbar.shopLabel", "announcement.text", "hero.headline", "hero.subtext", "hero.ctaLabel",
        "featuredCategories.heading", "newArrivals.heading", "bestSellers.heading",
        "promoBanner.heading", "promoBanner.subtext", "promoBanner.ctaLabel", "brandStory.heading",
        "brandStory.body", "reviews.heading", "reviews.item1.quote", "reviews.item1.author",
        "reviews.item2.quote", "reviews.item3.quote", "instagram.heading", "footer.about",
      ] as const) {
        assertShows(home, c[key], `${id} home (${key})`);
      }
      assert.ok(home.includes(c["instagram.handle"].replace(/^@/, "")), "instagram handle missing");
      assertShows(home, fillTokens(c["footer.copyright"], { name: "Demo Boutique" }), `${id} footer`);
      // Featured categories are the store's real top-level categories, linking to real pages.
      const topLevel = await prisma.category.findMany({ where: { tenantId: tenant.id, parentId: null } });
      assert.ok(topLevel.length > 0, "demo store needs categories; run pnpm demo:seed");
      const featured = chunk(home, "featuredCategories");
      for (const cat of topLevel) {
        assert.ok(featured.includes(cat.name), `${id}: featured tile missing category ${cat.name}`);
        assert.ok(featured.includes(`/category/${cat.slug}`), `${id}: tile for ${cat.name} doesn't link to its page`);
      }
      ok("every section shows its content from the shared keys");

      const arrivals = chunk(home, "newArrivals");
      for (const p of products) {
        assert.ok(arrivals.includes(p.name) && arrivals.includes(money(p.priceCents)), `new arrivals missing ${p.name}`);
      }
      const bestHtml = chunk(home, "bestSellers");
      for (const p of best) assert.ok(bestHtml.includes(p.name), `best sellers missing ${p.name}`);
      for (const p of notBest) assert.ok(!bestHtml.includes(p.name), `best sellers wrongly shows ${p.name}`);
      ok("New arrivals lists every product; Best sellers only the flagged ones");

      const productPage = await page(`/store/${SLUG}/products/${detail.slug}`);
      assert.deepEqual(sectionsIn(productPage), ["announcement", "navbar", "footer"]);
      for (const t of [detail.name, money(detail.priceCents), detail.description.split("\n")[0]]) {
        assert.ok(productPage.includes(t), `product page (${id}) missing "${t}"`);
      }
      // Stock is per variant: a multi-variant product asks the shopper to choose first, a
      // single-variant product shows its own stock right away.
      const stock =
        detail.variants.length > 1
          ? c["product.selectOptions"]
          : detail.variants[0].stock > 0
            ? c["product.inStock"]
            : c["product.outOfStock"];
      assert.ok(productPage.includes(stock), `stock label "${stock}" missing`);
      if (detail.variants.length > 1) {
        for (const attr of Object.keys(detail.variants[0].attributes)) {
          assert.ok(productPage.includes(`data-option="${attr}:`), `variant picker missing ${attr}`);
        }
      }
      ok("product page renders with the same shell (announcement, navbar, footer)");

      for (const [toggle, { section, probe }] of Object.entries(optionalContent) as [OptionalSection, { section: string; probe: string }][]) {
        await setSectionVisible(tenant.id, toggle, false);
        const off = await page(`/store/${SLUG}`);
        // The Hero switch hides only the hero text: with a hero image the section stays
        // (image only), so there it's the text that must be gone, not the section.
        const stays = toggle === "heroText" && !!(c["hero.image"] || c["hero.imageMobile"]);
        if (!stays) assert.ok(!sectionsIn(off).includes(section), `${id}: ${section} still shown when off`);
        assert.ok(!off.includes(probe), `${id}: ${section} content leaked while off`);
        assert.deepEqual(
          sectionsIn(off),
          stays ? [...SECTION_ORDER] : SECTION_ORDER.filter((s) => s !== section),
          `${id}: other sections changed when ${section} was switched off`,
        );
        assert.equal(
          (await prisma.tenantContent.count({ where: { tenantId: tenant.id } })),
          rows.length,
          "toggling deleted content rows",
        );
        await setSectionVisible(tenant.id, toggle, true);
        const back = await page(`/store/${SLUG}`);
        assert.ok(sectionsIn(back).includes(section) && back.includes(probe), `${id}: ${section} did not come back`);
      }
      ok("each optional section hides when off and returns with its content when on");

      const d = TEMPLATE_META[id].defaults;
      assert.ok(home.includes(`--color-primary:${d.primaryColor}`), "default primary not injected");
      await saveThemeOverrides(tenant.id, { primaryColor: "#ff00aa", accentColor: "#00ccff" });
      const themed = await page(`/store/${SLUG}`);
      assert.ok(themed.includes("--color-primary:#ff00aa") && themed.includes("--color-accent:#00ccff"), "overrides not injected");
      assert.ok(themed.includes(`--color-secondary:${d.secondaryColor}`), "unset color should use the template default");
      await saveThemeOverrides(tenant.id, {});
      ok("theme colors injected as CSS variables; unset colors use template defaults");

      assert.equal(await fingerprint(tenant.id), before, `${id}: content/products/visibility changed after switching!`);
      ok("content, products and section visibility unchanged (checksum)");
    }

    console.log("Brand-new store (3 seeded content rows, no products):");
    const run = Date.now().toString(36);
    const fresh = await createStoreWithOwner({
      storeName: `Fresh ${run}`,
      ownerName: "Fresh",
      ownerEmail: `fresh-${run}@example.test`,
      passwordHash: await hashPassword("unused-password-1"),
    });
    try {
      for (const id of TEMPLATE_IDS) {
        await setTenantTemplate(fresh.tenant.id, id);
        const html = await page(`/store/${fresh.tenant.slug}`);
        // Optional sections need content, Featured categories needs categories, and Instagram
        // needs a handle or photos.
        assert.deepEqual(
          sectionsIn(html),
          ["navbar", "hero", "newArrivals", "bestSellers", "footer"],
          `${id}: unexpected sections for a brand-new store`,
        );
        assert.ok(html.includes("No products yet"), `${id}: empty new-arrivals message missing`);
      }
      ok("new store renders sanely in every template (no empty optional sections, no blank Instagram strip)");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: fresh.tenant.id } });
      await prisma.user.deleteMany({ where: { id: fresh.user.id } });
    }

    console.log("Hostile data:");
    await saveThemeOverrides(tenant.id, {
      primaryColor: "red;} body{display:none",
      accentColor: "url(javascript:alert(1))",
      backgroundColor: "#12345",
      // @ts-expect-error deliberately invalid shape
      junk: "x",
    });
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { sectionVisibility: { promoBanner: "yes", brandStory: 0, extra: true } },
    });
    const hostile = await page(`/store/${SLUG}`);
    // The store's own template (whatever it is now), not a position in TEMPLATE_IDS.
    const current = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).templateId;
    assert.ok(!hostile.includes("display:none") && !hostile.includes("javascript:"), "unvalidated theme value leaked");
    assert.ok(
      hostile.includes(`--color-primary:${TEMPLATE_META[normalizeTemplateId(current)].defaults.primaryColor}`),
      "should fall back to template defaults",
    );
    const s = sectionsIn(hostile);
    assert.ok(!s.includes("promoBanner") && s.includes("brandStory"), "bad visibility values should fall back to defaults");
    ok("invalid stored colors and visibility values fall back to defaults; nothing injected");
  } finally {
    await setTenantTemplate(tenant.id, original.templateId);
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        themeOverrides: original.overrides ?? {},
        sectionVisibility: original.visibility ?? {},
      },
    });
  }
  console.log(`\nAll ${checks} template checks passed (settings restored).`);
}

main()
  .catch((e) => {
    console.error("\nTEMPLATE CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
