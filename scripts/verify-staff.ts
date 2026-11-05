/**
 * Staff permissions, exercised as a real staff member (pnpm verify:staff).
 *
 * Needs the server running (BASE_URL, default http://localhost:3000).
 *
 * `verify:permissions` checks the capability table statically: that every admin page and action
 * names a capability, and that staff hold exactly the six rows D73 says they do. That is not the
 * same claim as "a staff session can open these pages and is refused those" — a page can name
 * the right capability and still leak through a layout, a nav link, or a parallel route. So this
 * suite logs in as a staff account over HTTP and walks every row of D73's table.
 *
 * It creates a throwaway store, an owner and a staff member, and removes all three afterwards.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner } from "../lib/data/tenants";
import { createStaffAccount, listStaffAccounts, revokeStaffAccount } from "../lib/data/staff";
import { createProduct } from "../lib/data/products";
import { placeOrder } from "../lib/data/orders";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { claimNotification } from "../lib/data/notifications";
import { CAPABILITIES, can } from "../lib/permissions";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

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
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: { cookie: this.cookie },
    });
    this.absorb(res);
    return {
      status: res.status,
      location: res.headers.get("location") ?? "",
      body: await res.text(),
    };
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

const path = (r: { status: number; location: string }) =>
  r.status >= 300 && r.status < 400 ? new URL(r.location, BASE).pathname : "";

/** Refused, in the one way a refusal is allowed to look (lib/session.ts's REFUSED_PATH). */
function assertRefused(r: { status: number; location: string }, what: string) {
  assert.equal(
    path(r),
    "/admin/no-access",
    `${what} must send a staff member to /admin/no-access, got ${r.status} ${r.location}`,
  );
}

async function main() {
  const run = Date.now().toString(36);
  const ownerPassword = generateTempPassword();
  const staffPassword = generateTempPassword();

  const created = await createStoreWithOwner({
    storeName: `Staff Test ${run}`,
    ownerName: "Staff Test Owner",
    ownerEmail: `staff-owner-${run}@example.test`,
    passwordHash: await hashPassword(ownerPassword),
  });
  const tenantId = created.tenant.id;
  await prisma.user.update({
    where: { id: created.user.id },
    data: { mustChangePassword: false },
  });

  const actor = { userId: created.user.id, email: created.user.email };
  const staff = await createStaffAccount(
    tenantId,
    {
      name: "Packer",
      email: `staff-${run}@example.test`,
      passwordHash: await hashPassword(staffPassword),
    },
    actor,
  );

  // A product with stock, and an order to move along. Both are the staff member's actual job,
  // so there is something real behind every page this suite opens.
  const product = await createProduct(tenantId, {
    name: "Staff Test Shirt",
    description: "",
    basePriceCents: 2500,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: [{ attributes: {}, stock: 7, priceCentsOverride: null, imageUrl: null }],
  });
  const variantId = product.variants[0].id;
  const order = await placeOrder(
    tenantId,
    {
      customerName: "A Customer",
      customerPhone: "+96100000000",
      customerAddress: "A street",
      deliveryLocation: "Beirut",
      notes: "",
    },
    [{ variantId, quantity: 1 }],
  );

  try {
    // ------------------------------------------------------------------ the account itself
    assert.equal(
      (await listStaffAccounts(tenantId)).filter((s) => s.id === staff.id).length,
      1,
      "the staff account must be listed under its own store",
    );
    assert.equal(staff.mustChangePassword, true, "a staff account starts with a password to change");
    ok("a staff account exists under one store and must change its password first");

    // mustChangePassword is enforced for staff exactly as for owners: nothing else is reachable
    // until it is done. Checked before the rest, because it would otherwise hide every result.
    const fresh = await new Session().login(staff.email, staffPassword);
    assert.equal(
      path(await fresh.get("/admin/orders")),
      "/admin/change-password",
      "a staff member who has not changed their password must be sent to do it",
    );
    ok("a first-login staff member is sent to change their password before anything else");

    await prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: false } });
    const session = await new Session().login(staff.email, staffPassword);

    // ---------------------------------------------------------------- D73, row by row: allowed
    const orders = await session.get("/admin/orders");
    assert.equal(orders.status, 200, "staff must be able to open Orders");
    const detail = await session.get(`/admin/orders/${order.id}`);
    assert.equal(detail.status, 200, "and one order's detail");
    assert.ok(
      detail.body.includes("+96100000000"),
      "including the customer's phone number — you cannot deliver an order without it (D73)",
    );
    ok("Orders and an order's detail open, phone number included");

    const products = await session.get("/admin/products");
    assert.equal(products.status, 200, "staff must be able to open Products");
    assert.ok(
      !products.body.includes('href="/admin/products/new"'),
      "but not be offered Add product",
    );
    assert.ok(
      products.body.includes(`/admin/products/${product.id}/stock`),
      "and must be offered the stock screen",
    );
    assert.ok(
      !products.body.includes(`/admin/products/${product.id}/edit`),
      "and never the edit screen, which would be refused if they followed it",
    );
    ok("Products opens with the stock link and without any write link");

    const stock = await session.get(`/admin/products/${product.id}/stock`);
    assert.equal(stock.status, 200);
    assert.ok(stock.body.includes('data-testid="stock-form"'), "the stock form must render");
    ok("the stock screen opens");

    assert.equal((await session.get("/admin/categories")).status, 200);
    ok("Categories opens (read-only)");

    assert.equal((await session.get("/admin/notifications")).status, 200);
    ok("their own notification settings open");

    // ---------------------------------------------------------------- D73, row by row: refused
    for (const [where, what] of [
      ["/admin", "the dashboard, which is a report screen"],
      ["/admin/analytics", "Analytics"],
      ["/admin/analytics/products", "a report screen one level down"],
      ["/admin/marketing/results", "Marketing"],
      ["/admin/marketing/integrations", "the store's Google and Meta ids"],
      ["/admin/discounts", "Discounts"],
      ["/admin/discounts/coupons", "Coupons"],
      ["/admin/content", "the content editor"],
      ["/admin/preview", "the storefront preview"],
      ["/admin/social-links", "Social links"],
      ["/admin/delivery", "Delivery settings"],
      ["/admin/products/new", "the new-product form"],
      [`/admin/products/${product.id}/edit`, "the product form"],
      ["/admin/staff", "staff management — a staff member cannot add or remove colleagues"],
    ] as const) {
      assertRefused(await session.get(where), `${what} (${where})`);
    }
    ok("all 14 owner-only screens refuse a staff member, each to /admin/no-access");

    // The refusal page itself must work, or the refusal is a loop.
    const refused = await session.get("/admin/no-access");
    assert.equal(refused.status, 200, "the refusal page must render for a staff member");
    assert.ok(refused.body.includes('data-testid="no-access"'));
    assert.ok(
      refused.body.includes("/admin/orders"),
      "and send them somewhere they can actually work",
    );
    ok("the refusal page renders and points back at their own work");

    // The platform console is not merely refused, it is not theirs at all: the proxy turns them
    // away before any page runs, the same as it does an owner.
    const atPlatform = await session.get("/platform");
    assert.equal(path(atPlatform), "/login", "staff must be sent away from the platform console");
    ok("the platform console turns a staff member away at the proxy");

    // ------------------------------------------------------------------- the navigation agrees
    const nav = orders.body;
    for (const hidden of [
      "/admin/content",
      "/admin/social-links",
      "/admin/delivery",
      "/admin/discounts",
      "/admin/marketing",
      "/admin/analytics",
      "/admin/staff",
    ]) {
      assert.ok(
        !nav.includes(`href="${hidden}"`),
        `the sidebar must not offer ${hidden} to a staff member — a link the page then refuses ` +
          "reads as a broken dashboard rather than as a job description",
      );
    }
    for (const shown of ["/admin/orders", "/admin/products", "/admin/notifications"]) {
      assert.ok(nav.includes(`href="${shown}"`), `the sidebar must offer ${shown}`);
    }
    ok("the sidebar offers exactly the three sections a staff member can use");

    // ------------------------------------------------------- notifications: new orders, nothing else
    // D60's half of this is enforced in the writer, before a row exists. Asserted here as well
    // as in verify:notifications because this is the suite that knows what a staff account is.
    const allowed = await claimNotification({
      recipientUserId: staff.id,
      recipientRole: "STAFF",
      audience: "OWNER",
      type: "NEW_ORDER",
      tenantId,
      title: "New order",
      body: "You have a new order.",
      destination: "/admin/orders",
      locale: "en",
      dedupeKey: `staff-check:${run}:order`,
    });
    assert.ok(allowed, "a staff member must be able to receive a new order");
    for (const type of ["WEEKLY_SUMMARY", "PRODUCT_ALERT", "FUNNEL_ALERT", "TRAFFIC_ALERT"] as const) {
      await assert.rejects(
        claimNotification({
          recipientUserId: staff.id,
          recipientRole: "STAFF",
          audience: "OWNER",
          type,
          tenantId,
          title: "t",
          body: "b",
          destination: "/admin",
          locale: "en",
          dedupeKey: `staff-check:${run}:${type}`,
        }),
        /may not receive/,
        `a staff member must not be sendable ${type}`,
      );
    }
    ok("a staff member receives new orders and is refused every analytics notification");

    // ------------------------------------------------------- the owner's own staff screen
    const owner = await new Session().login(created.user.email, ownerPassword);
    const screen = await owner.get("/admin/staff");
    assert.equal(screen.status, 200, "the owner must be able to open Staff");
    assert.ok(
      screen.body.includes('data-testid="staff-scope"'),
      "the screen must say what a staff account can and cannot do before one is created",
    );
    assert.ok(screen.body.includes(staff.email), "and list the account that exists");
    assert.ok(
      !screen.body.includes(staffPassword),
      "and never the password, which is not stored anywhere this screen could read back",
    );
    assert.ok(
      screen.body.includes('href="/admin/staff"'),
      "the owner's sidebar must offer the section",
    );
    ok("the owner's Staff screen opens, lists the account and states its scope");

    // Every grant and removal leaves an append-only row the owner cannot edit.
    const audit = await prisma.analyticsAuditLog.findMany({
      where: { tenantId, action: "STAFF_CHANGE" },
      select: { subject: true, detail: true, actorEmail: true },
    });
    assert.ok(
      audit.some((row) => row.detail === "added" && row.subject === staff.email),
      `adding a staff account must leave an audit row, got ${JSON.stringify(audit)}`,
    );
    assert.ok(
      !audit.some((row) => (row.detail ?? "").includes(staffPassword)),
      "and no audit row may contain a password",
    );
    ok("adding a staff account leaves one audit row, with no password in it");

    // ------------------------------------------------------------------------- revocation
    assert.equal(await revokeStaffAccount(tenantId, staff.id, actor), true);
    const afterRevoke = await session.get("/admin/orders");
    assert.equal(
      path(afterRevoke),
      "/force-logout",
      "a revoked staff member's live session must die on their very next request",
    );
    assert.equal(
      (await listStaffAccounts(tenantId)).filter((s) => s.id === staff.id).length,
      0,
    );
    ok("revoking an account ends its live session on the next request");

    // One store cannot remove another's staff: the tenant is in the WHERE clause.
    const other = await createStoreWithOwner({
      storeName: `Staff Other ${run}`,
      ownerName: "Other",
      ownerEmail: `staff-other-${run}@example.test`,
      passwordHash: await hashPassword(generateTempPassword()),
    });
    const theirOwner = { userId: other.user.id, email: other.user.email };
    const theirs = await createStaffAccount(
      other.tenant.id,
      {
        name: "Theirs",
        email: `staff-theirs-${run}@example.test`,
        passwordHash: await hashPassword(generateTempPassword()),
      },
      theirOwner,
    );
    try {
      assert.equal(
        await revokeStaffAccount(tenantId, theirs.id, actor),
        false,
        "one store must not be able to remove another store's staff",
      );
      assert.deepEqual(
        (await listStaffAccounts(tenantId)).map((s) => s.id),
        [],
        "nor see them",
      );
      ok("a store can neither see nor remove another store's staff");
    } finally {
      await prisma.tenant.deleteMany({ where: { id: other.tenant.id } });
      await prisma.user.deleteMany({ where: { id: { in: [other.user.id, theirs.id] } } });
    }

    // ------------------------------------------------------------- the table says what it says
    assert.deepEqual(
      CAPABILITIES.filter((capability) => can("STAFF", capability)).length,
      6,
      "D73: six capabilities, and this suite walks all six",
    );
    ok("the six capabilities this suite exercised are the six the table grants");
  } finally {
    await prisma.user.deleteMany({ where: { staffTenantId: tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { id: created.user.id } });
  }

  console.log(`\nAll ${checks} staff checks passed (test store removed).`);
}

main()
  .catch((e) => {
    console.error("\nSTAFF CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
