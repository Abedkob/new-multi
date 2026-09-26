import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveContent } from "../lib/content";
import { createStoreWithOwner, updateTenantSocialLinks } from "../lib/data/tenants";
import { prisma } from "../lib/prisma";
import { publicSocialLinks, socialLinksSchema } from "../lib/social-links";
import { buildStorefrontData } from "../lib/storefront-data";
import { StoreFooter, type FooterLook } from "../templates/store-footer";
import { WhatsAppContactButton } from "../components/whatsapp-contact-button";

let checks = 0;
const ok = (message: string) => {
  checks++;
  console.log(`  ok  ${message}`);
};

async function main() {

const empty = socialLinksSchema.parse({
  instagramUrl: "",
  facebookUrl: "  ",
  tiktokUrl: "",
  whatsappNumber: "",
  googleMapsUrl: "",
});
assert.deepEqual(empty, {
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  whatsappNumber: null,
  googleMapsUrl: null,
});
ok("all five contact links are optional and blanks normalize to null");

for (const invalid of ["instagram.com/store", "/profile", "javascript:alert(1)", "not a link"]) {
  const parsed = socialLinksSchema.safeParse({
    instagramUrl: invalid,
    facebookUrl: "",
    tiktokUrl: "",
    whatsappNumber: "",
    googleMapsUrl: "",
  });
  assert.equal(parsed.success, false, `${invalid} should be rejected`);
}
ok("relative, unsafe and malformed values are rejected");

const whatsapp = socialLinksSchema.parse({
  instagramUrl: "",
  facebookUrl: "",
  tiktokUrl: "",
  whatsappNumber: "70 123 456",
  googleMapsUrl: "",
});
assert.equal(whatsapp.whatsappNumber, "96170123456");
ok("a Lebanese local WhatsApp number normalizes to an international wa.me number");

const configured = publicSocialLinks({
  instagramUrl: "https://instagram.com/store",
  facebookUrl: null,
  tiktokUrl: "https://tiktok.com/@store",
  whatsappNumber: "96170123456",
  googleMapsUrl: "https://maps.app.goo.gl/example",
});
assert.deepEqual(configured.map((link) => link.platform), ["instagram", "tiktok", "whatsapp", "googleMaps"]);
assert.equal(configured.find((link) => link.platform === "whatsapp")?.href, "https://wa.me/96170123456");
ok("only configured links enter storefront data in canonical order");

const data = buildStorefrontData({
  store: { name: "Social Test", slug: "social-test", basePath: "/store/social-test" },
  content: resolveContent([]),
  sectionVisibility: {},
  newArrivals: [],
  bestSellers: [],
  categories: [],
  categoryProductImages: [],
  socialLinks: {
    instagramUrl: "https://instagram.com/store",
    facebookUrl: null,
    tiktokUrl: null,
    whatsappNumber: "96170123456",
    googleMapsUrl: "https://maps.app.goo.gl/example",
  },
});
assert.equal(data.socialLinks.length, 3);
ok("storefront data exposes normalized non-empty links");

const looks: FooterLook[] = [
  "minimal",
  "classic",
  "tonkic",
  "fashion",
  "luxury",
  "atelier",
  "atlas",
  "pearl",
  "drop",
  "kinetic",
  "mirage",
  "muse",
];
for (const look of looks) {
  const html = renderToStaticMarkup(createElement(StoreFooter, { data, look }));
  assert.ok(html.includes('aria-label="Social links"'), `${look} is missing social navigation`);
  assert.ok(html.includes('href="https://instagram.com/store"'), `${look} is missing Instagram`);
  assert.ok(html.includes('target="_blank"'), `${look} social links should open separately`);
  assert.ok(html.includes('rel="noopener noreferrer"'), `${look} external link rel is unsafe`);
  for (const platform of ["instagram", "whatsapp", "googleMaps"]) {
    assert.ok(html.includes(`data-platform-icon="${platform}"`), `${look} is missing the ${platform} icon`);
  }
  assert.ok(!/#[0-9a-f]{3,8}/i.test(html), `${look} emitted a hardcoded color`);
}
ok("all footer looks render safe, theme-token social links");

const whatsappLink = data.socialLinks.find((link) => link.platform === "whatsapp");
const whatsappButton = renderToStaticMarkup(createElement(WhatsAppContactButton, { link: whatsappLink }));
assert.ok(whatsappButton.includes('data-testid="whatsapp-contact-button"'));
assert.ok(whatsappButton.includes('href="https://wa.me/96170123456"'));
assert.ok(whatsappButton.includes('aria-label="Chat with us on WhatsApp"'));
assert.equal(renderToStaticMarkup(createElement(WhatsAppContactButton, { link: undefined })), "");
ok("floating WhatsApp contact renders only when configured and uses the safe wa.me link");

for (const look of looks) {
  const source = readFileSync(join("templates", look, "index.tsx"), "utf8");
  assert.ok(source.includes(`<StoreFooter data={data} look="${look}" />`), `${look} bypasses StoreFooter`);
  assert.equal((source.match(/<footer\b/g) ?? []).length, 0, `${look} still owns footer markup`);
}
ok("all template footers delegate to the shared component");

const run = Date.now().toString(36);
const created = await createStoreWithOwner({
  storeName: `Social Test ${run}`,
  ownerName: "Social Test",
  ownerEmail: `social-${run}@example.test`,
  passwordHash: "test-only-not-a-login-password",
});
try {
  await updateTenantSocialLinks(created.tenant.id, {
    instagramUrl: "https://instagram.com/persisted",
    facebookUrl: null,
    tiktokUrl: "https://tiktok.com/@persisted",
    whatsappNumber: "96170123456",
    googleMapsUrl: null,
  });
  const stored = await prisma.tenant.findUniqueOrThrow({
    where: { id: created.tenant.id },
    select: { instagramUrl: true, facebookUrl: true, tiktokUrl: true, whatsappNumber: true, googleMapsUrl: true },
  });
  assert.deepEqual(stored, {
    instagramUrl: "https://instagram.com/persisted",
    facebookUrl: null,
    tiktokUrl: "https://tiktok.com/@persisted",
    whatsappNumber: "96170123456",
    googleMapsUrl: null,
  });
  ok("nullable links persist independently for one store");
} finally {
  await prisma.tenant.deleteMany({ where: { id: created.tenant.id } });
  await prisma.user.deleteMany({ where: { id: created.user.id } });
}

console.log(`\nAll ${checks} social-link/footer checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nSOCIAL LINKS CHECK FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
