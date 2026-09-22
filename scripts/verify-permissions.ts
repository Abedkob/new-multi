/**
 * Permission check (pnpm verify:permissions). Needs the server running (BASE_URL, default
 * http://localhost:3000) and the platform admin seeded (PLATFORM_ADMIN_* in .env).
 *
 * Logs in over HTTP as (a) nobody, (b) a throwaway store owner, (c) the platform admin and
 * checks who can reach the template/theme controls, the content + visibility controls,
 * and each other's areas. Also statically checks that every server action verifies a role.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../lib/passwords";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DEMO_SLUG = process.env.STORE_SLUG ?? "demo-boutique";

let checks = 0;
const ok = (name: string) => {
  checks++;
  console.log(`  ok  ${name}`);
};

class Session {
  private jar = new Map<string, string>();
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  private get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async get(path: string) {
    const res = await fetch(BASE + path, { redirect: "manual", headers: { cookie: this.cookie } });
    this.absorb(res);
    return { status: res.status, location: res.headers.get("location") ?? "", body: await res.text() };
  }
  async login(email: string, password: string) {
    const csrf = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: this.cookie } });
    this.absorb(csrf);
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: this.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password }),
    });
    this.absorb(res);
    assert.ok(
      [...this.jar.keys()].some((k) => k.includes("session-token")),
      `login failed for ${email} (status ${res.status})`,
    );
    return this;
  }
}

const isLoginRedirect = (r: { status: number; location: string }) =>
  r.status >= 300 && r.status < 400 && new URL(r.location, BASE).pathname === "/login";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function staticActionGuard() {
  console.log("Server actions:");
  // Login and logout are intentionally public.
  const publicFiles = new Set([join("app", "login", "actions.ts"), join("app", "actions", "auth.ts")]);
  let count = 0;
  for (const file of walk("app").filter((f) => /actions?\.ts$/.test(f))) {
    const src = readFileSync(file, "utf8");
    if (!src.trimStart().startsWith('"use server"')) continue;
    if (publicFiles.has(file)) continue;
    // Guest storefront actions (cart lookup, checkout) are public by design; they are scoped by
    // the store slug and covered by verify:commerce and the e2e checkout run instead.
    if (file.startsWith(join("app", "store") + "\\") || file.startsWith("app/store/")) continue;
    const parts = src.split(/^export async function /m).slice(1);
    assert.ok(parts.length > 0, `${file}: no exported actions found`);
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      const wants = file.includes(`${join("app", "platform")}`) ? "requirePlatformAdmin(" : "requireOwner(";
      assert.ok(part.includes(wants), `${file}: ${name}() does not call ${wants})`);
      count++;
    }
  }
  ok(`all ${count} server actions verify the right role (owner actions: requireOwner, platform actions: requirePlatformAdmin)`);
}

async function main() {
  staticActionGuard();

  const demo = await prisma.tenant.findUnique({ where: { slug: DEMO_SLUG } });
  if (!demo) throw new Error(`Store "${DEMO_SLUG}" not found. Run pnpm demo:seed first.`);

  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL!;
  const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD!;

  // Throwaway owner with a known password, removed afterwards.
  const run = Date.now().toString(36);
  const ownerPassword = generateTempPassword();
  const created = await createStoreWithOwner({
    storeName: `Perm Test ${run}`,
    ownerName: "Perm Test",
    ownerEmail: `perm-${run}@example.test`,
    passwordHash: await hashPassword(ownerPassword),
  });
  await prisma.user.update({ where: { id: created.user.id }, data: { mustChangePassword: false } });
  const themePath = `/platform/stores/${created.tenant.slug}/theme`;
  const previewPath = `/platform/preview/${created.tenant.slug}`;

  try {
    console.log("Anonymous visitor:");
    const anon = new Session();
    for (const p of ["/admin/content", "/admin/products", "/admin/categories", "/admin/orders", "/admin/preview", themePath, previewPath]) {
      assert.ok(isLoginRedirect(await anon.get(p)), `${p} should redirect to /login`);
    }
    ok("admin and platform pages redirect to /login");

    console.log("Store owner:");
    const owner = await new Session().login(created.user.email, ownerPassword);
    const content = await owner.get("/admin/content");
    assert.equal(content.status, 200);
    for (const s of ["announcementBar", "promoBanner", "brandStory", "reviews"]) {
      assert.ok(content.body.includes(`toggle-${s}`), `content page is missing the ${s} switch`);
    }
    ok("can open Content, which has the 4 section switches");
    const ownerPreview = await owner.get("/admin/preview");
    assert.equal(ownerPreview.status, 200);
    assert.ok(ownerPreview.body.includes("Perm Test"), "owner preview should show the owner's own store");
    assert.ok(!ownerPreview.body.includes("Demo Boutique"), "owner preview leaked another store");
    ok("owner live preview (/admin/preview) shows only their own store");
    assert.ok(
      !/id="templateId"|name="primaryColor"|Template and theme/i.test(content.body),
      "template/theme controls leaked onto the owner's content page",
    );
    const dash = await owner.get("/admin");
    assert.equal(dash.status, 200);
    assert.ok(!dash.body.includes("/admin/theme"), "owner nav/dashboard links to a theme page");
    ok("no template or color controls anywhere in the owner dashboard");
    assert.equal((await owner.get("/admin/theme")).status, 404);
    ok("/admin/theme no longer exists (404)");
    for (const p of [themePath, previewPath, `/platform/stores/${DEMO_SLUG}/theme`, "/platform/stores"]) {
      assert.ok(isLoginRedirect(await owner.get(p)), `owner reached ${p}`);
    }
    ok("cannot reach any /platform page, including the theme editor and its preview");
    for (const p of ["/admin/products", "/admin/categories", "/admin/orders"]) {
      assert.equal((await owner.get(p)).status, 200, `owner should open ${p}`);
    }
    ok("can open Products, Categories and Orders (all owner-only, scoped to their store)");

    console.log("Platform admin:");
    const admin = await new Session().login(adminEmail, adminPassword);
    const theme = await admin.get(themePath);
    assert.equal(theme.status, 200);
    assert.ok(theme.body.includes('id="templateId"') && theme.body.includes('name="primaryColor"'), "theme page lacks controls");
    ok("/platform/stores/[slug]/theme works: template picker and color inputs present");
    assert.equal((await admin.get("/platform/stores/does-not-exist-xyz/theme")).status, 404);
    ok("unknown store slug is a 404");
    const preview = await admin.get(previewPath);
    assert.equal(preview.status, 200);
    assert.ok(preview.body.includes('data-section="hero"'), "preview did not render the storefront");
    ok("live-preview route renders the storefront for the platform admin");
    assert.equal((await admin.get("/platform/templates")).status, 404);
    ok("the old /platform/templates gallery is gone (404)");
    assert.ok(isLoginRedirect(await admin.get("/admin/content")), "admin should not be able to use owner pages");
    assert.ok(isLoginRedirect(await admin.get("/admin/preview")), "admin should not reach the owner preview");
    for (const p of ["/admin/orders", "/admin/categories", "/admin/products"]) {
      assert.ok(isLoginRedirect(await admin.get(p)), `platform admin should not reach ${p}`);
    }
    ok("platform admin is not treated as a store owner (/admin redirects)");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: created.tenant.id } });
    await prisma.user.deleteMany({ where: { id: created.user.id } });
  }
  console.log(`\nAll ${checks} permission checks passed (test store removed).`);
}

main()
  .catch((e) => {
    console.error("\nPERMISSION CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
