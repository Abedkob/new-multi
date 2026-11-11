/**
 * The stockroom's two read screens, through a real owner session (pnpm verify:stock-ui).
 *
 * `verify:stock` exercises the ledger in process and `verify:staff` walks these screens as a staff
 * member. What is left is the half only a browser-shaped request can answer, and each item below has
 * a wrong answer that looks finished:
 *
 *  - **the module gate is a 404, for the owner too.** A store whose operator never switched the
 *    module on has no stockroom; a screen that rendered empty would read as "you have no stock".
 *  - **a row about a deleted variant still reads.** `updateProduct` hard-deletes variants an owner
 *    removes from the form, so the `VARIANT_REMOVED` movement is the only surviving record of the
 *    stock it held — and it must show the product's name and the option's attributes from its own
 *    snapshots, not a blank cell.
 *  - **a reason is a sentence.** `SALE` and `ORDER_CANCELLED` mean nothing to a shopkeeper. The
 *    enum in a tab's `href` is fine and is how a filtered list becomes a URL; the enum rendered
 *    where a sentence belongs is the failure.
 *  - **Arabic is Arabic.** A dictionary key that was added to `en.ts` and forgotten in `ar.ts`
 *    renders as `undefined` or as English, and nothing else in the suite would notice.
 *  - **unit cost is the owner's.** `verify:staff` proves its absence; this proves its presence, or
 *    "staff cannot see it" would pass just as well on a column that exists for nobody.
 *
 * Needs the server running (BASE_URL). Admin-only, so there is no custom-domain leg to write — the
 * refusal is proven instead, the way verify:report-states proves P5-34.
 */

import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, setTenantStock } from "../lib/data/tenants";
import { createProduct, setVariantStock, updateProduct } from "../lib/data/products";
import { generateTempPassword, hashPassword } from "../lib/passwords";
import { ADMIN_LOCALE_COOKIE } from "../lib/i18n/locale";
import { ar } from "../lib/i18n/dictionaries/ar";
import { en } from "../lib/i18n/dictionaries/en";
import { LOW_STOCK } from "../lib/variants";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let checks = 0;
const ok = (message: string) => {
  checks++;
  console.log(`  ok  ${message}`);
};

class Session {
  private jar = new Map<string, string>();
  constructor(private readonly extra: Record<string, string> = {}) {}
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i < 0) continue;
      const value = pair.slice(i + 1);
      if (value === "") this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), value);
    }
  }
  private get cookie() {
    return [...Object.entries(this.extra), ...this.jar]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
  async get(path: string) {
    const res = await fetch(BASE + path, { redirect: "manual", headers: { cookie: this.cookie } });
    this.absorb(res);
    return { status: res.status, body: await res.text() };
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
      "login did not produce a session cookie",
    );
    return this;
  }
  /** The same session, with the admin dashboard switched to another language. */
  withLocale(locale: string) {
    const clone = new Session({ ...this.extra, [ADMIN_LOCALE_COOKIE]: locale });
    for (const [k, v] of this.jar) clone.jar.set(k, v);
    return clone;
  }
}

function requestWithHost(path: string, host: string) {
  const url = new URL(BASE);
  return new Promise<{ status: number }>((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Every screen the module adds. All four are 404 before it is switched on. */
const PATHS = [
  "/admin/stock",
  "/admin/stock/history",
  "/admin/stock/receive",
  "/admin/stock/count",
] as const;

async function main() {
  const run = Date.now().toString(36);
  const password = generateTempPassword();
  const store = await createStoreWithOwner({
    storeName: `Stockroom ${run}`,
    ownerName: "Stock Owner",
    ownerEmail: `stock-ui-${run}@example.test`,
    passwordHash: await hashPassword(password),
  });
  const T = store.tenant.id;
  const actor = { userId: store.user.id, name: "Stock Owner" };
  const base = {
    description: "",
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: null,
    lowStockThreshold: null,
  };

  try {
    // A new owner starts with a password to change, and nothing else in the panel is reachable
    // until they do (that rule has its own leg in verify:staff). Cleared here so this suite is
    // about the stockroom.
    await prisma.user.update({
      where: { id: store.user.id },
      data: { mustChangePassword: false },
    });
    const owner = await new Session().login(store.user.email, password);

    // ------------------------------------------------------------------- the module gate
    for (const path of PATHS) {
      assert.equal(
        (await owner.get(path)).status,
        404,
        `${path} must not exist for a store whose module was never switched on — for the owner ` +
          "either. An empty screen would read as 'you have no stock'",
      );
    }
    ok("both screens are 404 until the platform switches the module on");

    await setTenantStock(T, store.user.id);

    // A product whose only option is below the platform default, so it lands on the attention
    // list, plus one with its own threshold so the "Warn at" column has two different numbers.
    const low = await createProduct(
      T,
      {
        ...base,
        name: `Linen Shirt ${run}`,
        basePriceCents: 10000,
        variants: [{ attributes: { Size: "M" }, stock: 2, priceCentsOverride: null, imageUrl: null }],
      },
      actor,
    );
    const roomy = await createProduct(
      T,
      {
        ...base,
        name: `Canvas Tote ${run}`,
        basePriceCents: 4000,
        lowStockThreshold: 50,
        variants: [{ attributes: {}, stock: 20, priceCentsOverride: null, imageUrl: null }],
      },
      actor,
    );
    const lowVariant = low.variants[0].id;
    await setVariantStock(T, lowVariant, 1, actor);

    // ------------------------------------------------------------------- the overview
    {
      const page = await owner.get("/admin/stock");
      assert.equal(page.status, 200, "the overview must open once the module is on");
      assert.ok(page.body.includes(low.name), "a variant below its threshold is listed");
      assert.ok(
        page.body.includes(roomy.name),
        "and so is one below a threshold the owner raised themselves — 20 left is low when the " +
          "owner said 50, which is the whole point of a per-product threshold",
      );
      assert.ok(
        page.body.includes(`>${LOW_STOCK}<`) && page.body.includes(">50<"),
        "the threshold that applied is shown per row, not one number for the shop",
      );
      ok("the overview lists what is running low, each against its own threshold");
    }

    // ------------------------------------------------------------------- the search
    {
      const found = await owner.get("/admin/stock?q=Canvas");
      assert.equal(found.status, 200);
      assert.ok(found.body.includes(roomy.name), "a search by product name finds its options");
      assert.ok(
        !found.body.includes(low.name),
        "and shows only what matched: a search that still listed the attention rows would be a " +
          "filter that filters nothing",
      );

      const miss = await owner.get("/admin/stock?q=zzzznothing");
      assert.ok(
        miss.body.includes(en["stock.found.none"]),
        "a search with no match says so, rather than rendering an empty table",
      );

      // One character is a scan of the whole catalogue and answers nothing useful.
      const tooShort = await owner.get("/admin/stock?q=C");
      assert.ok(
        tooShort.body.includes(en["stock.found.none"]),
        "a one-character query is refused rather than run",
      );
      ok("the search finds a product by name, says when nothing matches, and refuses one letter");
    }

    // ------------------------------------------------------------------- the history
    {
      const page = await owner.get("/admin/stock/history");
      assert.equal(page.status, 200, "the history must open");
      assert.ok(
        page.body.includes(en["stock.reason.ADJUST"]) &&
          page.body.includes(en["stock.reason.OPENING"]),
        "every reason is rendered as its sentence",
      );
      assert.ok(
        !/>\s*(ADJUST|OPENING|SALE|VARIANT_REMOVED)\s*</.test(page.body),
        "and the enum is never the text of an element (its presence in a tab's href is the point " +
          "of a filtered list being a URL)",
      );
      // D92's other half. verify:staff proves the column is absent for staff; a column that
      // existed for nobody would satisfy that check just as well.
      assert.ok(
        page.body.includes(en["stock.table.unitCost"]),
        "the owner sees the cost column: it is their margin, and it is the owner's to see",
      );
      ok("the history reads in sentences, and the owner gets the cost column");
    }

    // ------------------------------------------------------------------- one variant's history
    {
      const scoped = await owner.get(`/admin/stock/history?variant=${lowVariant}`);
      assert.equal(scoped.status, 200);
      assert.ok(scoped.body.includes(low.name), "the scope notice names what is being shown");
      assert.ok(
        !scoped.body.includes(roomy.name),
        "and the other product's movements are not in it",
      );
      assert.ok(
        scoped.body.includes(en["stock.scope.clear"]),
        "with a way back to everything, or a scoped history is a dead end",
      );
      // The scope has to travel with every reason tab, or clicking one silently widens a
      // one-variant history to the whole store — which reads as the filter having worked.
      const reasonTabs = [...scoped.body.matchAll(/href="([^"]*\breason=[^"]*)"/g)].map(
        (m) => m[1],
      );
      assert.ok(
        reasonTabs.length > 0,
        "this leg is only worth anything if the scoped page actually drew reason tabs",
      );
      const leaking = reasonTabs.filter((href) => !href.includes(`variant=${lowVariant}`));
      assert.deepEqual(
        leaking,
        [],
        `these tabs drop the scope and would widen the history to the whole store: ${leaking.join(", ")}`,
      );
      ok("a single variant's history shows only its own movements, and keeps its scope");
    }

    // ------------------------------------------------------------------- a removed option
    {
      // Two options, then one of them removed through the form — the write that destroys stock
      // with no record unless the ledger catches it first (D90).
      const pair = await createProduct(
        T,
        {
          ...base,
          name: `Wool Scarf ${run}`,
          basePriceCents: 6000,
          variants: [
            { attributes: { Colour: "Rust" }, stock: 9, priceCentsOverride: null, imageUrl: null },
            { attributes: { Colour: "Slate" }, stock: 3, priceCentsOverride: null, imageUrl: null },
          ],
        },
        actor,
      );
      const keep = pair.variants[1].id;
      await updateProduct(
        T,
        pair.id,
        {
          ...base,
          name: pair.name,
          basePriceCents: 6000,
          variants: [
            { id: keep, attributes: { Colour: "Slate" }, stock: 3, priceCentsOverride: null, imageUrl: null },
          ],
        },
        actor,
      );

      const page = await owner.get(`/admin/stock/history?reason=VARIANT_REMOVED`);
      assert.equal(page.status, 200);
      assert.ok(
        page.body.includes(pair.name),
        "the product's name is read from the movement's own snapshot, because the variant is gone",
      );
      assert.ok(page.body.includes("Rust"), "and so are the option's attributes");
      assert.ok(
        page.body.includes(en["stock.table.removed"]),
        "and the row says the option no longer exists, instead of linking nowhere",
      );
      ok("a removed option's write-off still reads, from its own snapshots");
    }

    // ------------------------------------------------------------------- the two forms
    {
      const receive = await owner.get("/admin/stock/receive");
      assert.equal(receive.status, 200, "receiving must open for the owner");
      const count = await owner.get("/admin/stock/count");
      assert.equal(count.status, 200, "counting must open for the owner");
      for (const [path, page] of [
        ["/admin/stock/receive", receive],
        ["/admin/stock/count", count],
      ] as const) {
        assert.ok(
          page.body.includes('role="combobox"'),
          `${path} must offer the picker as a combobox, so a keyboard and a screen reader can ` +
            "both drive it",
        );
        assert.ok(
          page.body.includes(en["stock.form.aboutTitle"]),
          `${path} must render its reference and note fields`,
        );
      }

      // **Why the cost column is checked here and not in the markup.** It is a per-line field, so
      // it cannot appear on a form with no lines — which means "the owner sees it" and "staff do
      // not" would BOTH pass against an empty form, for the same wrong reason. Adding a line needs
      // the client-side picker, which a fetch cannot drive. So the chain is checked where it is
      // actually decided: each page computes the prop from the role, `costForRole` is the rule
      // (verify:stock), and the action goes through it (verify:stock, statically).
      const receiveSource = readFileSync("app/admin/(panel)/stock/receive/page.tsx", "utf8");
      assert.match(
        receiveSource,
        /withCost=\{maySeeStockCost\(role\)\}/,
        "receiving must decide the cost column from the role",
      );
      const countSource = readFileSync("app/admin/(panel)/stock/count/page.tsx", "utf8");
      assert.match(
        countSource,
        /withCost=\{false\}/,
        "counting must not ask for a cost at all: a figure nobody standing at a shelf has",
      );
      ok("both forms render the picker as a combobox, and the cost column is decided by role");
    }

    // ------------------------------------------------------------------- a paused store
    {
      await prisma.tenant.update({ where: { id: T }, data: { isPaused: true, pausedAt: new Date() } });
      for (const path of ["/admin/stock/receive", "/admin/stock/count"]) {
        assert.equal(
          (await owner.get(path)).status,
          404,
          `${path} must close while the store is paused: a back-office channel left open while ` +
            "the storefront is dark would blunt the platform's one commercial lever",
        );
      }
      // The history is a different question, and must stay open: pausing a store must not hide
      // the movements it already recorded.
      assert.equal((await owner.get("/admin/stock/history")).status, 200);
      await prisma.tenant.update({ where: { id: T }, data: { isPaused: false, pausedAt: null } });
      ok("pausing the store closes the two forms and leaves the history readable");
    }

    // ------------------------------------------------------------------- Arabic
    {
      const arabic = owner.withLocale("ar");
      for (const path of PATHS) {
        const page = await arabic.get(path);
        assert.equal(page.status, 200, `${path} must render in Arabic`);
        assert.ok(page.body.includes('dir="rtl"'), `${path} must be laid out right to left`);
      }
      const history = await arabic.get("/admin/stock/history");
      assert.ok(
        history.body.includes(ar["stock.reason.ADJUST"]),
        "a reason is shown in Arabic, not left in English",
      );
      assert.ok(
        !history.body.includes(en["stock.reason.ADJUST"]),
        "and the English is not there beside it — a key added to en.ts and forgotten in ar.ts is " +
          "the failure this catches, and nothing else in the suite would",
      );
      // As rendered text, not anywhere: Next's own flight payload contains the word for its own
      // reasons, and asserting on the whole document would be a check about the framework.
      const missing = /<(t[dh]|span|p|h[1-6])[^>]*>\s*undefined\s*</.exec(history.body);
      assert.equal(
        missing,
        null,
        `a missing dictionary key renders as undefined, which no amount of RTL layout makes ` +
          `acceptable: ${missing?.[0]}`,
      );
      ok("both screens render right-to-left with their Arabic copy and no English left behind");
    }

    // ------------------------------------------------------------------- not on a store's domain
    {
      const host = `stockroom-${run}.test`;
      await prisma.tenant.update({ where: { id: T }, data: { domain: host } });
      for (const path of PATHS) {
        const res = await requestWithHost(path, host);
        assert.equal(
          res.status,
          404,
          `${path} must be 404 on a store's own domain, got ${res.status}`,
        );
      }
      ok("the stockroom does not exist on a store's own domain, like every other admin path");
    }
  } finally {
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: store.user.id } });
  }

  console.log(`\nAll ${checks} stock UI checks passed (test store removed).`);
}

main()
  .catch((e) => {
    console.error("\nSTOCK UI CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
