/**
 * The import screens through real sessions (pnpm verify:import-ui).
 *
 * Needs the dev or production server running; `BASE_URL` overrides the default.
 *
 * **The point of this suite is the capability split**, which is also the reason there are two
 * screens rather than one. A page names one capability: the catalogue sheet is `products:write`
 * and the stock sheet is `stock:move`, which staff hold. Only a real staff cookie can prove that
 * the owner-only screen refuses them and the stock one admits them — the static check in
 * `verify:permissions` proves each file names *a* capability, not that the right person gets
 * through.
 *
 * The downloads are checked as downloads: status, content type, the `Content-Disposition`
 * filename, and that the bytes are a workbook our own reader can open. A route that 200s with an
 * HTML error page would pass a status check and fail a merchant.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";

import bcrypt from "bcryptjs";

import { readWorkbook } from "../lib/catalogue-sheet/workbook";
import { parseStockSheet } from "../lib/catalogue-sheet/parse";
import { createProduct } from "../lib/data/products";
import { createStaffAccount } from "../lib/data/staff";
import { createStoreWithOwner, setTenantStock } from "../lib/data/tenants";
import { prisma } from "../lib/prisma";

const BASE = process.env.BASE_URL ?? "http://localhost:3004";
const RUN = Date.now().toString(36);
/** Generated here and never written anywhere: nothing in this suite reads a real credential. */
const PASSWORD = `Pw-${randomBytes(12).toString("base64url")}`;

let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
}

/** The same cookie-jar shape verify-permissions uses, kept small on purpose. */
class Session {
  cookie = "";

  private remember(res: Response) {
    const set = res.headers.getSetCookie?.() ?? [];
    const jar = new Map(
      this.cookie
        .split("; ")
        .filter(Boolean)
        .map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    );
    for (const raw of set) {
      const [pair] = raw.split(";");
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    this.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async get(path: string) {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      headers: { cookie: this.cookie },
    });
    this.remember(res);
    return res;
  }

  async login(email: string) {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: this.cookie } });
    this.remember(csrfRes);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: this.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password: PASSWORD, csrfToken, callbackUrl: BASE }),
    });
    this.remember(res);
    assert.ok(this.cookie.includes("session-token"), `login failed for ${email}`);
  }
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A request with a `Host` of our choosing, over raw `node:http`.
 *
 * **`fetch` cannot do this.** `host` is a forbidden header in undici, so it is dropped silently —
 * the request goes out with `localhost:3004` and the proxy quite correctly serves the platform
 * host. The custom-domain leg written with `fetch` therefore asserted 404 against a request that
 * was never on a custom domain, got 200, and looked like a product defect; the honest version has
 * to set the header at the socket, which is what `pentest-cross-tenant.ts` does and why.
 */
function requestWithHost(
  path: string,
  host: string,
  cookie: string,
): Promise<{ status: number; body: string }> {
  const origin = new URL(BASE);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: origin.hostname,
        port: origin.port,
        path,
        method: "GET",
        headers: { host, ...(cookie ? { cookie } : {}) },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** A download, checked as a download rather than as a status code. */
async function expectWorkbook(session: Session, path: string, filenamePart: string) {
  const res = await session.get(path);
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  assert.equal(res.headers.get("content-type"), XLSX, `${path} is not served as a workbook`);
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /^attachment; filename="[a-z0-9-]+\.xlsx"$/, `${path}: ${disposition}`);
  assert.ok(disposition.includes(filenamePart), `${path}: ${disposition}`);
  // The store name goes through slugify, so no owner-controlled punctuation reaches the header.
  assert.ok(!/[\r\n";]/.test(disposition.slice('attachment; filename="'.length, -1)));
  assert.equal(res.headers.get("cache-control"), "no-store", `${path} must not be cacheable`);
  const buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), "PK", `${path} did not return a zip`);
  return buffer;
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const store = await createStoreWithOwner({
    storeName: `Import UI ${RUN}`,
    ownerName: "Import UI Owner",
    ownerEmail: `import-ui-owner-${RUN}@example.test`,
    passwordHash,
  });
  const T = store.tenant.id;
  const OWNER = store.user.id;
  const staffEmail = `import-ui-staff-${RUN}@example.test`;

  try {
    await prisma.user.update({ where: { id: OWNER }, data: { mustChangePassword: false } });
    await setTenantStock(T, OWNER);
    await createProduct(
      T,
      {
        name: "Walked Shelf Mug",
        description: "",
        basePriceCents: 1_200,
        imageUrl: "",
        images: [],
        isBestSeller: false,
        categoryId: null,
        variants: [{ attributes: {}, stock: 6, priceCentsOverride: null, imageUrl: null }],
      },
      { userId: OWNER, name: "Import UI Owner" },
    );
    const staff = await createStaffAccount(
      T,
      { name: "Import UI Staff", email: staffEmail, passwordHash },
      { userId: OWNER, email: store.user.email },
    );
    await prisma.user.update({ where: { id: staff.id }, data: { mustChangePassword: false } });

    const owner = new Session();
    await owner.login(store.user.email);
    const assistant = new Session();
    await assistant.login(staffEmail);

    console.log("The owner:");

    await check("the catalogue import screen opens", async () => {
      const res = await owner.get("/admin/products/import");
      assert.equal(res.status, 200);
      const body = await res.text();
      // The sentence that matters most on this screen, because it is the mitigation for matching
      // by name and the thing a merchant has to read before their first upload.
      assert.ok(body.includes("found again by its name"), "the name-matching warning is missing");
      assert.ok(body.includes('accept=".xlsx,.xlsm,.csv,.tsv"'), "both formats must be offered");
    });

    await check("the blank template downloads as a workbook", async () => {
      const buffer = await expectWorkbook(owner, "/admin/products/import/template", "catalogue-template");
      const { sheets } = await readWorkbook(buffer);
      assert.deepEqual(Object.keys(sheets).sort(), ["products", "stock", "variants"]);
    });

    await check("the catalogue exports with the store's real rows", async () => {
      const buffer = await expectWorkbook(owner, "/admin/products/export", "catalogue");
      const { sheets } = await readWorkbook(buffer);
      assert.ok(
        sheets.products!.flat().includes("Walked Shelf Mug"),
        "the export must carry the store's own products",
      );
    });

    await check("the products screen offers the import, and the stock screen the count", async () => {
      // The nav is filtered from the same table the pages enforce, so a link can never offer
      // something the page behind it would refuse.
      const products = await owner.get("/admin/products");
      assert.match(await products.text(), /\/admin\/products\/import/);
      const stock = await owner.get("/admin/stock");
      assert.match(await stock.text(), /\/admin\/stock\/import/);
    });

    console.log("\nThe staff member, which is why there are two screens:");

    await check("the catalogue import is refused to /admin/no-access", async () => {
      const res = await assistant.get("/admin/products/import");
      // Never /login (the cookie is valid and the proxy admits both store roles to /admin, so
      // /login would loop) and never a 404 (the page exists, it is just not theirs).
      assert.ok(res.status >= 300 && res.status < 400, `expected a redirect, got ${res.status}`);
      assert.match(res.headers.get("location") ?? "", /\/admin\/no-access/);
    });

    await check("so is the catalogue template, and the export", async () => {
      // These were the repository's first guarded route handlers, and a layout does not run in
      // front of a route handler — so this is the only check that proves the guard is really there.
      for (const path of ["/admin/products/import/template", "/admin/products/export"]) {
        const res = await assistant.get(path);
        assert.match(res.headers.get("location") ?? "", /\/admin\/no-access/, `${path} was served`);
      }
    });

    await check("the stock count screen is theirs", async () => {
      const res = await assistant.get("/admin/stock/import");
      assert.equal(res.status, 200, "a stockroom assistant must be able to upload what they counted");
    });

    await check("and so is the count sheet, with the shelves filled in", async () => {
      const buffer = await expectWorkbook(assistant, "/admin/stock/import/sheet", "stock-count");
      const { sheets } = await readWorkbook(buffer);
      assert.ok(sheets.stock, "the count sheet must be in it");
      assert.ok(sheets.stock!.flat().includes("Walked Shelf Mug"));
      // Counted is blank: a count sheet that agreed with the system by construction would be
      // signed off by somebody.
      assert.equal(parseStockSheet(sheets.stock!).rows.length, 0);
    });

    console.log("\nOn a store's own domain, none of this exists:");

    await check("every import path 404s on a custom domain", async () => {
      // A custom domain changes the origin, the cookie path, the secure context and the proxy's
      // host routing at once. Admin paths are platform-host only, and a leg that cannot run is a
      // failure rather than a skip (verify:e2e-policy).
      const host = `import-ui-${RUN}.test`;
      await prisma.tenant.update({ where: { id: T }, data: { domain: host } });
      try {
        // The leg has to be proved to be ON the custom domain before anything it asserts means
        // something: the storefront must answer there, with this store in it. Without this the
        // whole leg can pass against a host the proxy never routed.
        const storefront = await requestWithHost("/", host, "");
        assert.equal(storefront.status, 200, `the storefront must answer on ${host}`);
        assert.ok(
          storefront.body.includes(store.tenant.name),
          "the custom domain must be serving THIS store, or the leg proves nothing",
        );

        for (const path of [
          "/admin/products/import",
          "/admin/products/import/template",
          "/admin/products/export",
          "/admin/stock/import",
          "/admin/stock/import/sheet",
        ]) {
          const res = await requestWithHost(path, host, owner.cookie);
          assert.equal(res.status, 404, `${path} answered ${res.status} on a store's own domain`);
        }
      } finally {
        await prisma.tenant.update({ where: { id: T }, data: { domain: null } });
      }
    });
  } finally {
    await prisma.user.deleteMany({ where: { email: staffEmail } });
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
  }

  console.log(`\nAll ${checks} import UI checks passed (test store removed).`);
}

main()
  .catch((error) => {
    console.error("\nIMPORT UI CHECK FAILED\n", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
