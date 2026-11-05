/**
 * Permission check (pnpm verify:permissions). Needs the server running (BASE_URL, default
 * http://localhost:3000) and the platform admin seeded (PLATFORM_ADMIN_* in .env).
 *
 * Logs in over HTTP as (a) nobody, (b) a throwaway store owner, (c) the platform admin and
 * checks who can reach the template/theme controls, the content + visibility controls,
 * and each other's areas. Also statically checks that every server action verifies a role.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { saveCampaign } from "../lib/data/campaigns";
import { recordIntegrationChange } from "../lib/analytics/audit";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { ADMIN_CAPABILITIES, CAPABILITIES, can } from "../lib/permissions";
import type { Capability } from "../lib/permissions";

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

/**
 * P7-04: every page, layout and action under app/admin names a capability.
 *
 * This is the rule that inverts the old default. Before the capability table, a new admin screen
 * was reachable by whoever `requireOwner` happened to admit, and working out what a role could
 * do meant reading fifty files. Now a screen that names nothing fails this check, so a page
 * built after Phase 7 is refused to staff until somebody decides what it is for.
 *
 * Two narrow exemptions, both listed by name rather than matched by a pattern:
 *   - SELF: surfaces that grant nothing beyond "you work here" — the panel shell, the language
 *     switch, the change-password screen. They call requireTenantMember.
 *   - NO_GUARD: a file with no guard at all, which must be either the locale wrapper or a module
 *     whose entire body is a redirect. Asserted, not taken on trust.
 */
/**
 * Every capability named inside a `requireCapability(...)` call.
 *
 * Reads the whole argument list rather than only a literal first argument, because one call
 * legitimately chooses between two: `updateOrderStatusAction` asks for "orders:cancel" or
 * "orders:advance" depending on the status requested (D73). A check that only understood the
 * simple shape would have reported that action as naming nothing, and the obvious way to make
 * it pass would have been to widen the action to one capability — which is the opposite of what
 * this phase is for.
 */
function capabilitiesNamedIn(src: string): string[] {
  const found: string[] = [];
  const needle = "requireCapability(";
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    let depth = 0;
    let end = at + needle.length - 1;
    for (; end < src.length; end++) {
      if (src[end] === "(") depth++;
      else if (src[end] === ")" && --depth === 0) break;
    }
    const args = src.slice(at + needle.length, end);
    // Only the arguments that look like a capability. A conditional call also quotes the thing
    // it is branching on ("CANCELLED"), which is not one — but anything containing a colon is
    // claiming to be, so a typo there is caught below rather than silently ignored.
    for (const m of args.matchAll(/"([^"]+)"/g)) if (m[1].includes(":")) found.push(m[1]);
  }
  return found;
}

function adminCapabilityGuard() {
  console.log("Admin capabilities:");
  const SELF = new Set(
    [
      ["app", "admin", "(panel)", "layout.tsx"],
      ["app", "admin", "actions.ts"],
      ["app", "admin", "change-password", "page.tsx"],
      ["app", "admin", "change-password", "actions.ts"],
      ["app", "admin", "no-access", "page.tsx"],
    ].map((parts) => join(...parts)),
  );
  const NO_GUARD = new Set(
    [
      ["app", "admin", "layout.tsx"],
      ["app", "admin", "(panel)", "marketing", "page.tsx"],
      ["app", "admin", "(panel)", "analytics", "links", "page.tsx"],
    ].map((parts) => join(...parts)),
  );

  const named = new Map<Capability, string[]>();
  let guarded = 0;
  const files = walk(join("app", "admin")).filter((f) =>
    ["page.tsx", "layout.tsx", "actions.ts"].some((name) => basename(f) === name),
  );
  assert.ok(files.length > 40, `expected the whole admin surface, found ${files.length} files`);

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const caps = capabilitiesNamedIn(src);

    if (NO_GUARD.has(file)) {
      assert.ok(
        !src.includes("requireCapability(") && !src.includes("requireTenantMember("),
        `${file} is listed as needing no guard but has one — remove it from NO_GUARD`,
      );
      assert.ok(
        /\b(permanentRedirect|redirect)\(/.test(src) ||
          file.endsWith(join("app", "admin", "layout.tsx")),
        `${file} has no guard and is not a redirect: it must name a capability`,
      );
      continue;
    }

    if (SELF.has(file)) {
      assert.ok(
        src.includes("requireTenantMember("),
        `${file} is listed as granting nothing beyond membership, so it must call requireTenantMember`,
      );
      assert.equal(caps.length, 0, `${file} both grants membership and names a capability`);
      guarded++;
      continue;
    }

    assert.ok(
      caps.length > 0,
      `${file} names no capability. Every admin page and action must call ` +
        "requireCapability(...) from lib/permissions.ts — see D72. If it genuinely grants " +
        "nothing, add it to SELF in this script and say why.",
    );
    for (const cap of caps) {
      assert.ok(
        (CAPABILITIES as string[]).includes(cap),
        `${file} names "${cap}", which is not in ADMIN_CAPABILITIES`,
      );
      (named.get(cap as Capability) ?? named.set(cap as Capability, []).get(cap as Capability)!).push(file);
    }
    // Every exported server action in the file has to carry the guard itself, not inherit it
    // from the page that imports it: an action is its own HTTP endpoint.
    if (file.endsWith("actions.ts")) {
      for (const part of src.split(/^export async function /m).slice(1)) {
        const name = part.slice(0, part.indexOf("("));
        assert.ok(
          /requireCapability\(/.test(part),
          `${file}: ${name}() does not call requireCapability itself`,
        );
      }
    }
    guarded++;
  }

  ok(`all ${guarded} admin pages, layouts and actions name a capability from one table`);

  // Every capability is reachable, and every owner-only one is genuinely owner-only. A row
  // nothing names is a row nobody is enforcing.
  const unused = CAPABILITIES.filter((cap) => !named.has(cap) && cap !== "staff:manage");
  assert.deepEqual(unused, [], `capabilities declared but never named by any route: ${unused.join(", ")}`);
  for (const cap of CAPABILITIES) {
    const roles = ADMIN_CAPABILITIES[cap] as readonly string[];
    assert.ok(roles.includes("STORE_OWNER"), `${cap} must be available to the owner`);
  }
  assert.deepEqual(
    CAPABILITIES.filter((cap) => can("STAFF", cap)).sort(),
    [
      "categories:read",
      "notifications:self",
      "orders:advance",
      "orders:read",
      "products:read",
      "products:stock",
    ],
    "D73: exactly these six capabilities belong to staff. Changing this list is a product " +
      "decision, so it is written here as well as in the table.",
  );
  ok(`staff hold exactly 6 of ${CAPABILITIES.length} capabilities, and the owner holds all of them`);
}

function staticActionGuard() {
  console.log("Server actions:");
  // Login and logout are intentionally public.
  const publicFiles = new Set([join("app", "login", "actions.ts"), join("app", "actions", "auth.ts")]);
  let count = 0;
  const indirect: string[] = [];
  for (const file of walk("app").filter((f) => /actions?\.ts$/.test(f))) {
    // The admin subtree is held to the stricter capability rule above, not to this one.
    if (file.startsWith(join("app", "admin") + "\\") || file.startsWith("app/admin/")) continue;
    const src = readFileSync(file, "utf8");
    if (!src.trimStart().startsWith('"use server"')) continue;
    if (publicFiles.has(file)) continue;
    // Guest storefront actions (cart lookup, checkout) are public by design; they are scoped by
    // the store slug and covered by verify:commerce and the e2e checkout run instead.
    if (file.startsWith(join("app", "store") + "\\") || file.startsWith("app/store/")) continue;
    const parts = src.split(/^export async function /m).slice(1);
    assert.ok(parts.length > 0, `${file}: no exported actions found`);
    const wants = file.includes(`${join("app", "platform")}`) ? "requirePlatformAdmin(" : "requireOwner(";

    /**
     * Local helpers in this file that perform the guard themselves, so an action may satisfy
     * the rule by calling one.
     *
     * Added because the check failed on the privacy actions, which share a `resolve()` that
     * calls `requirePlatformAdmin` and then does the lookups — the guard was there, one call
     * away, and a check that cannot see one level of indirection pushes people towards
     * copy-pasting the guard rather than sharing it. One level only: beyond that the reader of
     * the action can no longer tell, and neither can this.
     */
    const guardingHelpers = [...src.matchAll(/^(?:async )?function (\w+)\(/gm)]
      .map((m) => m[1])
      .filter((helper) => {
        const body = src.slice(src.indexOf(`function ${helper}(`));
        return body.slice(0, body.indexOf("\n}\n") + 1).includes(wants);
      });

    for (const part of parts) {
      const name = part.slice(0, part.indexOf("("));
      const direct = part.includes(wants);
      const viaHelper = guardingHelpers.find((helper) => new RegExp(`\\b${helper}\\(`).test(part));
      assert.ok(
        direct || viaHelper,
        `${file}: ${name}() does not call ${wants}) — neither directly nor through a helper in the same file`,
      );
      if (!direct && viaHelper) indirect.push(`${name}() via ${viaHelper}()`);
      count++;
    }
  }
  ok(`all ${count} server actions verify the right role (owner actions: requireOwner, platform actions: requirePlatformAdmin)`);
  // Printed every run, so sharing the guard stays visible rather than becoming invisible.
  for (const line of indirect) console.log(`      via helper: ${line}`);
}

async function main() {
  adminCapabilityGuard();
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
    for (const p of ["/admin/content", "/admin/social-links", "/admin/delivery", "/admin/products", "/admin/categories", "/admin/orders", "/admin/preview", themePath, previewPath]) {
      assert.ok(isLoginRedirect(await anon.get(p)), `${p} should redirect to /login`);
    }
    ok("admin and platform pages redirect to /login");

    // ...but the two webmanifests must NOT, and this is the one exception under those prefixes.
    //
    // A browser fetches a manifest with `credentials: "omit"` unless the <link> says otherwise,
    // so the role gate saw an anonymous request and 307'd both of them to /login — for a
    // signed-in owner too. The browser never parsed either, and neither app could be installed
    // on any device. Nothing else noticed: every page behind them was correctly protected,
    // which is exactly what made it invisible. Found in Phase 7 by fetching the manifest.
    for (const [kind, path] of [
      ["merchant admin", "/admin/manifest.webmanifest"],
      ["platform console", "/platform/manifest.webmanifest"],
    ] as const) {
      const response = await anon.get(path);
      assert.equal(
        response.status,
        200,
        `${path} must answer an anonymous request (a browser sends no cookies for a manifest), ` +
          `got ${response.status} -> ${response.location}`,
      );
      const manifest = JSON.parse(response.body) as { icons?: { src: string }[] };
      assert.ok(manifest.icons?.length, `the ${kind} manifest lists no icons`);
      // Android refuses the install if an icon 404s, and the icons are fetched anonymously too.
      for (const icon of manifest.icons) {
        const served = await fetch(`${BASE}${icon.src}`);
        assert.equal(served.status, 200, `${icon.src} must be served (${kind}), got ${served.status}`);
      }
    }
    ok("both webmanifests and every icon they name are served to a browser with no session");

    console.log("Store owner:");
    const owner = await new Session().login(created.user.email, ownerPassword);
    const content = await owner.get("/admin/content");
    assert.equal(content.status, 200);
    for (const s of ["announcementBar", "promoBanner", "brandStory", "reviews"]) {
      assert.ok(content.body.includes(`toggle-${s}`), `content page is missing the ${s} switch`);
    }
    ok("can open Content, which has the 4 section switches");
    const socialLinks = await owner.get("/admin/social-links");
    assert.equal(socialLinks.status, 200);
    for (const name of ["instagramUrl", "facebookUrl", "tiktokUrl", "whatsappNumber", "googleMapsUrl"]) {
      assert.ok(socialLinks.body.includes(`name="${name}"`), `social links page is missing ${name}`);
    }
    ok("can open Social links, with four optional URLs and a WhatsApp number");
    const delivery = await owner.get("/admin/delivery");
    assert.equal(delivery.status, 200);
    for (const name of ["deliveryFee", "deliveryNote"]) {
      assert.ok(delivery.body.includes(`name="${name}"`), `delivery page is missing ${name}`);
    }
    ok("can open Delivery, with one fixed fee and an optional note");
    // Marketing -> Integrations: the owner's own Google and Meta ids (D40, P5-18b).
    const integrations = await owner.get("/admin/marketing/integrations");
    assert.equal(integrations.status, 200);
    for (const name of [
      "gaMeasurementId",
      "metaPixelId",
      "googleAdsId",
      "googleAdsPurchaseLabel",
      "metaDomainVerification",
      "googleSiteVerification",
    ]) {
      assert.ok(integrations.body.includes(`name="${name}"`), `integrations page is missing ${name}`);
    }
    assert.ok(
      integrations.body.includes("Pixel Helper") || integrations.body.includes("Tag Assistant"),
      "each integration must name the tool that checks it",
    );
    ok("can open Marketing > Integrations, with all six fields and a way to check them");
    // D40b: "last changed by X on Y", under the field it belongs to. Recorded as a platform
    // admin, because the case that matters is an owner seeing that somebody else touched their
    // tag — and because it proves the owner reads the line without reading the log.
    assert.ok(
      !integrations.body.includes("data-last-changed"),
      "a store whose ids have never been changed must show no provenance line at all",
    );
    await recordIntegrationChange({
      tenantId: created.tenant.id,
      actorUserId: null,
      actorEmail: "support@example.test",
      actorRole: "platform-admin",
      changes: [{ field: "gaMeasurementId", from: null, to: "G-PERMCHECK1" }],
    });
    const withHistory = await owner.get("/admin/marketing/integrations");
    assert.ok(
      withHistory.body.includes('data-last-changed="gaMeasurementId"'),
      "the changed field must carry its provenance line",
    );
    assert.ok(
      withHistory.body.includes("support@example.test") && withHistory.body.includes("Last changed by"),
      "naming who changed it",
    );
    assert.ok(
      !withHistory.body.includes("G-PERMCHECK1") ||
        !withHistory.body.includes("data-last-changed=\"metaPixelId\""),
      "and only for the field that changed",
    );
    ok("Marketing > Integrations shows who last changed each ID, and only for changed fields");
    // The Phase 4 path still works for anyone who bookmarked it (P5-15).
    const moved = await owner.get("/admin/analytics/links");
    assert.ok(
      moved.status >= 300 && moved.status < 400 && moved.location.endsWith("/admin/marketing/links"),
      `the old tracked-links path must redirect into Marketing, got ${moved.status} ${moved.location}`,
    );
    ok("the Phase 4 tracked-links path redirects into Marketing");
    // Marketing -> Campaigns (D39, P5-13): the tab is there, and a campaign saved before any
    // traffic is on it. Checked through a real session because the thing that would break it is
    // a route guard or a layout, not the data layer verify:campaigns already covers.
    const emptyCampaigns = await owner.get("/admin/marketing/campaigns");
    assert.equal(emptyCampaigns.status, 200);
    await saveCampaign(created.tenant.id, {
      name: "Perm Eid sale",
      utmCampaign: "perm-eid-sale",
      channel: "instagram",
      destinationPath: "/shop",
    });
    const campaigns = await owner.get("/admin/marketing/campaigns");
    assert.equal(campaigns.status, 200);
    assert.ok(
      campaigns.body.includes("Perm Eid sale") && campaigns.body.includes("perm-eid-sale"),
      "a saved campaign must be on the page before any traffic arrives",
    );
    ok("can open Marketing > Campaigns, which lists a campaign saved before any traffic");
    // Marketing -> Results (D38, P5-19). Empty here, which is the state that has to read as
    // "nothing yet" rather than as a broken page, and the section index must land on it.
    const results = await owner.get("/admin/marketing/results?period=7");
    assert.equal(results.status, 200);
    assert.ok(
      results.body.includes("No campaign traffic in this period yet"),
      "a store with no campaign traffic must be told so, not shown an empty table",
    );
    const section = await owner.get("/admin/marketing");
    assert.ok(
      section.status >= 300 && section.status < 400 && section.location.endsWith("/results"),
      `Marketing must open on Results, got ${section.status} ${section.location}`,
    );
    ok("can open Marketing > Results, which is where the section opens");
    // Notifications (§11.2): the owner's own screen, with its three sections and the iPhone
    // steps. Checked through a real session because what would break it is a route guard.
    const notifications = await owner.get("/admin/notifications");
    assert.equal(notifications.status, 200);
    for (const section of ["notification-types", "device-list", "iphone-guide"]) {
      assert.ok(
        notifications.body.includes(`data-testid="${section}"`),
        `the notifications page is missing its ${section} section`,
      );
    }
    assert.ok(
      notifications.body.includes("Add to Home Screen"),
      "and the iPhone steps, which are the difference between working and silently not (P6-18)",
    );
    // The amount toggle is present and off: it is the one setting that changes what lands on a
    // lock screen, so its default is worth asserting from the rendered page (D50).
    assert.ok(
      /name="showOrderAmount"[^>]*type="checkbox"/.test(notifications.body) ||
        notifications.body.includes('name="showOrderAmount"'),
      "the order-amount toggle must be on the page",
    );
    assert.ok(
      !/name="showOrderAmount"[^>]*checked/.test(notifications.body),
      "and it must start unchecked",
    );
    ok("can open Notifications, with its three sections, the iPhone steps and the amount off");
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
    assert.ok(isLoginRedirect(await admin.get("/admin/social-links")), "admin should not reach social links");
    assert.ok(isLoginRedirect(await admin.get("/admin/preview")), "admin should not reach the owner preview");
    for (const p of ["/admin/orders", "/admin/categories", "/admin/products"]) {
      assert.ok(isLoginRedirect(await admin.get(p)), `platform admin should not reach ${p}`);
    }
    ok("platform admin is not treated as a store owner (/admin redirects)");

    // Platform notifications (§11.9, P6-21): the admin's own screen, and an owner turned away.
    const platformNotifications = await admin.get("/platform/notifications");
    assert.equal(platformNotifications.status, 200);
    for (const section of ["notification-types", "device-list", "iphone-guide"]) {
      assert.ok(
        platformNotifications.body.includes(`data-testid="${section}"`),
        `the platform notifications page is missing its ${section} section`,
      );
    }
    assert.ok(
      !platformNotifications.body.includes('name="showOrderAmount"'),
      "there is no order-amount switch on the platform screen: its alerts carry no money",
    );
    const ownerAtPlatform = await owner.get("/platform/notifications");
    assert.ok(
      ownerAtPlatform.status >= 300 &&
        ownerAtPlatform.status < 400 &&
        !ownerAtPlatform.location.includes("/platform"),
      `an owner must be sent away from the platform console, got ${ownerAtPlatform.status}`,
    );
    ok("platform admin has their own notifications screen, and an owner cannot reach it");
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
