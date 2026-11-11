/**
 * Stock management: the low-stock alert and the movement ledger (pnpm verify:stock).
 *
 * What this suite proves that no other one does:
 *
 *  - that the low-stock alert fires on the TRANSITION into low and re-arms only when the stock
 *    goes back above the threshold. `verify:notifications` owns the delivery machinery and the
 *    role matrix; neither it nor anything else knows what "running low" means;
 *  - that the alert reaches a store with no analytics rollout, which is the one mistake that would
 *    make it invisible to almost every merchant;
 *  - that `LOW_STOCK` is registered in every place it has to be. The trap is specific:
 *    `OWNER_PREFERENCE_FIELD` is a `Partial` record, so omitting it is not a compile error, and
 *    `wantsNotification` then returns false for every owner — the alert would be silently
 *    unsendable with no error anywhere;
 *  - **the ledger invariant, after every writer has moved the same variants.** Five surfaces take
 *    stock off a shelf or put it back, and the one thing that must be true of all of them together
 *    is that the newest movement's `balanceAfter` equals what is actually there. The definition
 *    lives in `lib/stock/invariant.ts` so this suite and any future diagnostic cannot drift;
 *  - that with the module OFF not one movement row is written by any of them, which is the whole
 *    of the promise that a store without the module is unaffected;
 *  - that the product form can no longer overwrite a counted shelf, and that a variant the owner
 *    removes is written off before the row is destroyed — the two silent writes this phase exists
 *    to end.
 *
 * It exercises `evaluateLowStock` directly rather than through `lowStockSweep`, because the stage
 * short-circuits when push is not configured (no VAPID keys) and the sweep's own logic is what is
 * under test. With no registered devices `deliverNotification` queues nothing, which is exactly
 * what the assertions below rely on: the AdminNotification row is still the record of "this person
 * was told this".
 *
 * `evaluateLowStock` is global by design, so every assertion here is scoped to this suite's own
 * owner. Another store's low stock in the same database is not this suite's business.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { prisma, withTenant } from "../lib/prisma";
import { createStoreWithOwner, setTenantCounterSales, setTenantStock } from "../lib/data/tenants";
import { createProduct, setVariantStock, updateProduct, getProduct } from "../lib/data/products";
import { placeOrder, updateOrderStatus } from "../lib/data/orders";
import { recordCounterSale, voidCounterSale } from "../lib/data/counter-sales";
import { setStockTo } from "../lib/data/stock";
import {
  StockBatchError,
  recordStockReceipt,
  recordStocktake,
} from "../lib/data/stock-batches";
import {
  MAX_STOCK_LINES,
  costForRole,
  countedCeiling,
  parseStockCostCents,
  parseStockWhole,
} from "../lib/stock";
import { MAX_STOCK } from "../lib/variants";
import { deleteProduct } from "../lib/data/products";
import { describeStockDrift, findStockDrift } from "../lib/stock/invariant";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { evaluateLowStock } from "../lib/notifications/low-stock";
import { claimNotification } from "../lib/data/notifications";
import { wantsNotification } from "../lib/data/notification-preferences";
import { lowStockText } from "../lib/notifications/templates";
import { LOW_STOCK, effectiveLowStock } from "../lib/variants";
import type { ProductInput } from "../lib/data/products";

/**
 * Every .ts file containing `needle`, outside scripts/.
 *
 * `--untracked`, so a new file counts: a sixth stock writer added today must fail this check
 * today, not first become visible once somebody commits it.
 */
function gitGrepFiles(needle: string): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-F", "--untracked", needle, "--", "*.ts"], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("scripts/"))
      .sort();
  } catch {
    return [];
  }
}

let checks = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  checks++;
  console.log(`  ok  ${name}`);
}

const RUN = Date.now().toString(36);

async function main() {
  const store = await createStoreWithOwner({
    storeName: `Stock ${RUN}`,
    ownerName: "Stock Owner",
    ownerEmail: `stock-owner-${RUN}@example.test`,
    passwordHash: "x",
  });
  const T = store.tenant.id;
  const OWNER = store.user.id;

  const base = (over: Partial<ProductInput> = {}): ProductInput => ({
    name: "Thing",
    description: "",
    basePriceCents: 10000,
    imageUrl: "",
    images: [],
    isBestSeller: false,
    categoryId: null,
    variants: [{ attributes: {}, stock: 50, priceCentsOverride: null, imageUrl: null }],
    ...over,
  });
  const product = (name: string, stock: number, threshold?: number) =>
    createProduct(T, base({
      name,
      lowStockThreshold: threshold ?? null,
      variants: [{ attributes: {}, stock, priceCentsOverride: null, imageUrl: null }],
    }));

  /** Only this owner's alerts; the sweep is global and other stores are not our business. */
  const alerts = () =>
    prisma.adminNotification.findMany({
      where: { recipientUserId: OWNER, type: "LOW_STOCK" },
      orderBy: { createdAt: "asc" },
      select: { body: true, title: true, destination: true, dedupeKey: true },
    });
  const sweep = () => evaluateLowStock(new Date());
  const setStock = (variantId: string, stock: number) =>
    prisma.productVariant.update({ where: { id: variantId }, data: { stock } });

  try {
    // ----------- registration: the silent-failure trap
    await check("an owner wants LOW_STOCK by default, so the type is registered everywhere", async () => {
      assert.equal(
        await wantsNotification(OWNER, "STORE_OWNER", "LOW_STOCK"),
        true,
        "false here means LOW_STOCK is missing from OWNER_PREFERENCE_FIELD or NOTIFIABLE_TYPES — " +
          "neither of which is a compile error, and both of which silence every low-stock alert",
      );
    });

    await check("staff cannot be sent a low-stock alert, refused by the writer before a row exists", async () => {
      await assert.rejects(
        claimNotification({
          recipientUserId: OWNER,
          recipientRole: "STAFF",
          audience: "OWNER",
          type: "LOW_STOCK",
          tenantId: T,
          title: "x",
          body: "y",
          destination: "/admin",
          locale: "en",
          dedupeKey: `refused-${RUN}`,
        }),
        /STAFF may not receive LOW_STOCK/,
      );
      assert.equal((await alerts()).length, 0, "and nothing was written");
    });

    // ----------- the transition
    const shirt = await product("Alert Shirt", 2);
    const shirtVariant = shirt.variants[0].id;

    await check("a variant at the default threshold fires once, and a second sweep says nothing", async () => {
      await sweep();
      const first = await alerts();
      assert.equal(first.length, 1, "the crossing was announced");
      assert.ok(
        first[0].body.includes("Alert Shirt") && first[0].body.includes("2 left"),
        `the body names the product and what is left: ${first[0].body}`,
      );
      assert.ok(
        first[0].body.includes(`limit is ${LOW_STOCK}`),
        "and the threshold that applied, which is the owner's own number",
      );
      assert.equal(first[0].destination, `/admin/products/${shirt.id}/stock`);

      await sweep();
      assert.equal(
        (await alerts()).length,
        1,
        "the condition is still true, but it is not a new transition — this is the check that " +
          "stops an alert every five minutes for as long as a product stays low",
      );
    });

    await check("the body carries no variant id, only a product a merchant would recognise", async () => {
      const [first] = await alerts();
      assert.ok(
        !first.body.includes(shirtVariant) && !first.title.includes(shirtVariant),
        "a cuid in a lock-screen notification tells a shopkeeper nothing",
      );
    });

    await check("restocking above the threshold re-arms it, and running down again fires again", async () => {
      await setStock(shirtVariant, LOW_STOCK + 1);
      const restocked = await sweep();
      assert.ok(restocked.cleared >= 1, "the firing row was cleared");
      assert.equal((await alerts()).length, 1, "and nothing was sent for a store with nothing low");

      await setStock(shirtVariant, 1);
      await sweep();
      assert.equal(
        (await alerts()).length,
        2,
        "a second run-down is a second transition, or an alert would fire once per product ever",
      );
    });

    await check("sitting exactly on the threshold is low, and one above it is not", async () => {
      const edge = await product("Edge Case", LOW_STOCK + 1, LOW_STOCK);
      await sweep();
      assert.equal((await alerts()).length, 2, "one above the threshold is not low");

      await setStock(edge.variants[0].id, LOW_STOCK);
      await sweep();
      assert.equal((await alerts()).length, 3, "at the threshold is low");
    });

    await check("a threshold of 0 is respected: only an empty shelf is low", async () => {
      const zero = await product("Zero Threshold", 2, 0);
      assert.equal(effectiveLowStock({ lowStockThreshold: 0 }), 0);
      await sweep();
      assert.equal((await alerts()).length, 3, "2 left is not low when the owner said 0");

      await setStock(zero.variants[0].id, 0);
      await sweep();
      assert.equal((await alerts()).length, 4, "0 left is");
    });

    // ----------- one notification per store per sweep
    await check("several products crossing at once make one notification naming the count", async () => {
      const before = (await alerts()).length;
      const many = await Promise.all([
        product("Many A", 1),
        product("Many B", 1),
        product("Many C", 1),
        product("Many D", 1),
      ]);
      assert.equal(many.length, 4);
      await sweep();
      const after = await alerts();
      assert.equal(
        after.length,
        before + 1,
        "four crossings in one shop is one notification, not four buzzes",
      );
      assert.ok(
        /and 3 more products/.test(after[after.length - 1].body),
        `the body counts the rest: ${after[after.length - 1].body}`,
      );
    });

    await check("a store outside the analytics rollout is still told", async () => {
      // This store has never been put into the rollout — the default — so an alert built on
      // `ownerTenants()` would never have reached it. The alerts above are the proof.
      const tenant = await prisma.tenant.findUnique({
        where: { id: T },
        select: { analyticsPausedAt: true },
      });
      assert.equal(tenant?.analyticsPausedAt, null, "and it is not a paused-analytics store either");
      assert.ok((await alerts()).length > 0, "it received alerts regardless of the rollout");
    });

    await check("an owner who switches the preference off is not told again", async () => {
      await prisma.ownerNotificationPreference.upsert({
        where: { userId: OWNER },
        create: { userId: OWNER, lowStockAlerts: false },
        update: { lowStockAlerts: false },
      });
      const before = (await alerts()).length;
      const quiet = await product("Muted Product", 1);
      assert.ok(quiet.id);
      await sweep();
      assert.equal((await alerts()).length, before, "the preference governs the type");
      await prisma.ownerNotificationPreference.update({
        where: { userId: OWNER },
        data: { lowStockAlerts: true },
      });
    });

    // ----------- the wording, in both languages
    await check("both languages describe what was counted and stop", async () => {
      const en = lowStockText("en", { product: "Linen Shirt", left: 2, threshold: 5, others: 0 });
      const ar = lowStockText("ar", { product: "Linen Shirt", left: 2, threshold: 5, others: 0 });
      assert.match(en.body, /Linen Shirt: 2 left, your limit is 5\./);
      assert.ok(ar.body.includes("Linen Shirt"), "the product name is not translated");
      assert.ok(ar.body.includes("٢"), "Arabic uses Arabic-Indic digits");
      for (const text of [en, ar]) {
        assert.ok(
          !/because|should|order more|يجب|لأن/i.test(text.body),
          `a template states a count and stops: ${text.body}`,
        );
      }
      const many = lowStockText("en", { product: "A", left: 1, threshold: 3, others: 4 });
      assert.match(many.body, /A and 4 more products are running low\./);
    });

    // =======================================================================================
    // The ledger (C3)
    // =======================================================================================
    //
    // Everything below runs on THIS store, whose module is off until the switch check turns it
    // on. That ordering is deliberate: the "off writes nothing" claims have to be made against a
    // store that has genuinely never had the module, not one that was switched off again.
    const ledgerProduct = await product("Ledger Shirt", 20);
    const LV = ledgerProduct.variants[0].id;
    const customer = {
      customerName: "Ada Lovelace",
      customerPhone: "+1 555 010 0199",
      customerAddress: "1 Ledger Lane",
      deliveryLocation: "Front door",
      notes: "",
    };
    const actor = { userId: OWNER, name: "Stock Owner" };
    const movements = (variantId?: string) =>
      prisma.stockMovement.findMany({
        where: { tenantId: T, ...(variantId ? { variantId } : {}) },
        orderBy: [{ variantId: "asc" }, { variantSeq: "asc" }],
      });
    const stockOf = async (variantId: string) =>
      (await prisma.productVariant.findUnique({ where: { id: variantId }, select: { stock: true } }))
        ?.stock ?? -1;
    const drift = () => withTenant(T, (db) => findStockDrift(db, T));
    const assertNoDrift = async (where: string) => {
      const rows = await drift();
      assert.equal(rows.length, 0, `${where}: the ledger and the shelf disagree — ${describeStockDrift(rows)}`);
    };

    console.log("\nWith the module off, nothing changes:");
    await check("every writer moves stock and writes not one movement row", async () => {
      const order = await placeOrder(T, customer, [{ variantId: LV, quantity: 2 }]);
      assert.equal(await stockOf(LV), 18, "the sale still came off the shelf");
      await updateOrderStatus(T, order.id, "CANCELLED", actor);
      assert.equal(await stockOf(LV), 20, "and the cancellation still put it back");

      const set = await setVariantStock(T, LV, 15, actor);
      assert.equal(set.ok, true);
      assert.equal(await stockOf(LV), 15, "and a direct correction still lands");

      assert.equal(
        await prisma.stockMovement.count({ where: { tenantId: T } }),
        0,
        "a store that has never had the module must have no history at all",
      );
      assert.equal(await prisma.stockBatch.count({ where: { tenantId: T } }), 0);
    });

    await check("placeOrder asks the question on a read it already does, not an extra statement", () => {
      // The behavioural claim above cannot tell a free switch from one that costs a round trip on
      // every single checkout, so this is the structural half: placeOrder reads `stockEnabled` as
      // one more column on the FOR SHARE tenant row it already locks, and never calls the
      // standalone helper. The surfaces that DO call it (a cancellation, a void, a correction) are
      // the ones that had no tenant read to ride along on, and they are not on the checkout path.
      const source = readFileSync("lib/data/orders.ts", "utf8");
      const placeOrderBody = source.slice(
        source.indexOf("export async function placeOrder"),
        source.indexOf("export async function updateOrderStatus"),
      );
      assert.ok(placeOrderBody.length > 0, "placeOrder and updateOrderStatus must both be found");
      assert.match(
        placeOrderBody,
        /SELECT "isPaused", "deliveryFeeCents", "deliveryNote", "stockEnabled"/,
        "the switch must ride on the tenant row placeOrder already locks",
      );
      assert.ok(
        !placeOrderBody.includes("stockLedgerEnabled("),
        "placeOrder must not pay a separate read for the switch: every checkout would pay it",
      );
      return Promise.resolve();
    });

    console.log("\nThe switch:");
    await check("turning it on sets the first-enabled stamp once and never clears it", async () => {
      await setTenantStock(T, OWNER);
      const on = await prisma.tenant.findUniqueOrThrow({
        where: { id: T },
        select: { stockEnabled: true, stockFirstEnabledAt: true, stockEnabledBy: true },
      });
      assert.equal(on.stockEnabled, true);
      assert.equal(on.stockEnabledBy, OWNER);
      assert.ok(on.stockFirstEnabledAt, "the first-enabled stamp is set");

      await setTenantStock(T, null);
      await setTenantStock(T, OWNER);
      const again = await prisma.tenant.findUniqueOrThrow({
        where: { id: T },
        select: { stockEnabled: true, stockFirstEnabledAt: true },
      });
      assert.equal(again.stockEnabled, true);
      assert.deepEqual(
        again.stockFirstEnabledAt,
        on.stockFirstEnabledAt,
        "off and on again must not move the stamp: it is what keeps the history readable",
      );
      // The till too, for the writers below.
      await setTenantCounterSales(T, OWNER);
    });

    console.log("\nEvery writer, then the invariant:");
    await check("a storefront sale is recorded against the order, with the channel as the actor", async () => {
      const order = await placeOrder(T, customer, [{ variantId: LV, quantity: 3 }]);
      assert.equal(await stockOf(LV), 12);
      const rows = await movements(LV);
      // The shelf held 15 and nothing had ever been recorded, so the ledger opens at 15 before it
      // can say anything about this sale. That OPENING is the whole mechanism: without it the
      // first movement of a store's life would claim a balance it never established.
      assert.equal(rows.length, 2, `an OPENING then the sale: ${JSON.stringify(rows)}`);
      assert.equal(rows[0].reason, "OPENING");
      assert.equal(rows[0].delta, 0);
      assert.equal(rows[0].balanceAfter, 15);
      assert.equal(rows[0].variantSeq, 1);
      assert.equal(rows[1].reason, "SALE");
      assert.equal(rows[1].delta, -3);
      assert.equal(rows[1].balanceAfter, 12);
      assert.equal(rows[1].variantSeq, 2);
      assert.equal(rows[1].orderId, order.id);
      assert.equal(rows[1].actorUserId, null, "a shopper is not somebody an admin can hold responsible");
      assert.equal(rows[1].actorNameSnapshot, "Online store");
      assert.equal(rows[1].productNameSnapshot, "Ledger Shirt");
      await assertNoDrift("after a sale");
    });

    await check("a cancellation names the person who cancelled it, and the order it undid", async () => {
      const order = await placeOrder(T, customer, [{ variantId: LV, quantity: 4 }]);
      await updateOrderStatus(T, order.id, "CANCELLED", actor);
      const rows = await movements(LV);
      const last = rows[rows.length - 1];
      assert.equal(last.reason, "ORDER_CANCELLED");
      assert.equal(last.delta, 4);
      assert.equal(last.balanceAfter, 12);
      assert.equal(last.orderId, order.id);
      assert.equal(last.actorUserId, OWNER, "a person cancelled this, unlike the sale itself");
      await assertNoDrift("after a cancellation");
    });

    await check("the automatic expiry sweep records itself rather than an innocent person", async () => {
      const order = await placeOrder(T, customer, [{ variantId: LV, quantity: 1 }]);
      // No actor: this is the shape expireStalePendingOrders calls it in, where nobody pressed
      // anything. Attributing that to whoever happened to open the Orders page would put a name
      // on a decision they did not make.
      await updateOrderStatus(T, order.id, "CANCELLED");
      const rows = await movements(LV);
      const last = rows[rows.length - 1];
      assert.equal(last.reason, "ORDER_CANCELLED");
      assert.equal(last.actorUserId, null);
      assert.equal(last.actorNameSnapshot, "Automatic");
      await assertNoDrift("after an automatic cancellation");
    });

    let voidedSaleId = "";
    await check("a counter sale and its void are both recorded against the sale", async () => {
      const sale = await recordCounterSale(T, {
        submissionId: `ledger-${RUN}-1`,
        payment: "CASH",
        lines: [{ variantId: LV, quantity: 2 }],
        soldByUserId: OWNER,
        soldByName: "Stock Owner",
        role: "STORE_OWNER",
      });
      voidedSaleId = sale.id;
      let rows = await movements(LV);
      let last = rows[rows.length - 1];
      assert.equal(last.reason, "COUNTER_SALE");
      assert.equal(last.delta, -2);
      assert.equal(last.balanceAfter, 10);
      assert.equal(last.counterSaleId, sale.id);
      assert.equal(last.actorUserId, OWNER, "a counter sale is somebody's action and the till knows whose");

      await voidCounterSale(T, sale.id, {
        reason: "rang up twice",
        voidedByUserId: OWNER,
        voidedByName: "Stock Owner",
      });
      rows = await movements(LV);
      last = rows[rows.length - 1];
      assert.equal(last.reason, "COUNTER_VOID");
      assert.equal(last.delta, 2);
      assert.equal(last.balanceAfter, 12);
      assert.equal(last.counterSaleId, sale.id);
      await assertNoDrift("after a counter sale and its void");
    });

    await check("a direct correction is an ADJUST naming the person who made it", async () => {
      const set = await setVariantStock(T, LV, 9, actor);
      assert.equal(set.ok, true);
      const rows = await movements(LV);
      const last = rows[rows.length - 1];
      assert.equal(last.reason, "ADJUST");
      assert.equal(last.delta, -3, "12 down to 9");
      assert.equal(last.balanceAfter, 9);
      assert.equal(last.actorUserId, OWNER);
      await assertNoDrift("after an adjustment");
    });

    await check("every orderId and counterSaleId on a movement still resolves", async () => {
      const rows = await movements();
      const orderIds = [...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))];
      const saleIds = [...new Set(rows.flatMap((r) => (r.counterSaleId ? [r.counterSaleId] : [])))];
      assert.ok(orderIds.length >= 3 && saleIds.length >= 1, "there is something to check");
      assert.equal(
        await prisma.order.count({ where: { id: { in: orderIds } } }),
        orderIds.length,
        "a reference that does not resolve is worse than no reference: it reads as evidence",
      );
      assert.equal(
        await prisma.counterSale.count({ where: { id: { in: saleIds } } }),
        saleIds.length,
      );
    });

    await check("the per-variant counter is 1, 2, 3 … with no gap and no repeat", async () => {
      const rows = await movements(LV);
      assert.deepEqual(
        rows.map((r) => r.variantSeq),
        rows.map((_, i) => i + 1),
        "the only total order over one variant's history must be dense and unique",
      );
    });

    console.log("\nThe product form can no longer overwrite a counted shelf:");
    await check("saving the product ignores a saved variant's posted stock", async () => {
      const before = await stockOf(LV);
      const saved = await getProduct(T, ledgerProduct.id);
      assert.ok(saved);
      const ok = await updateProduct(
        T,
        ledgerProduct.id,
        {
          name: "Ledger Shirt",
          description: "",
          basePriceCents: 12000,
          imageUrl: "",
          images: [],
          isBestSeller: false,
          categoryId: null,
          lowStockThreshold: null,
          // 999 is what a stale tab, a restored form or a direct post would send.
          variants: [{ id: LV, attributes: {}, stock: 999, priceCentsOverride: null, imageUrl: null }],
        },
        actor,
      );
      assert.equal(ok, true);
      assert.equal(
        await stockOf(LV),
        before,
        "the posted figure must be IGNORED, not merely hidden on screen: the form holds " +
          "products:write and has never named products:stock",
      );
      const fresh = await prisma.product.findUniqueOrThrow({
        where: { id: ledgerProduct.id },
        select: { basePriceCents: true },
      });
      assert.equal(fresh.basePriceCents, 12000, "and the rest of the save still went through");
      await assertNoDrift("after a product save");
    });

    await check("a variant the owner removes is written off before the row is destroyed", async () => {
      const two = await createProduct(
        T,
        base({
          name: "Two Options",
          variants: [
            { attributes: { Size: "S" }, stock: 4, priceCentsOverride: null, imageUrl: null },
            { attributes: { Size: "M" }, stock: 7, priceCentsOverride: null, imageUrl: null },
          ],
        }),
        actor,
      );
      const [small, medium] = two.variants.map((v) => v.id);
      // Created with stock on them, so each opens at its own figure and nothing else.
      const opened = await movements(small);
      assert.equal(opened.length, 1, `an opening balance and no movement: ${JSON.stringify(opened)}`);
      assert.equal(opened[0].reason, "OPENING");
      assert.equal(opened[0].balanceAfter, 4);

      await updateProduct(
        T,
        two.id,
        {
          name: "Two Options",
          description: "",
          basePriceCents: 10000,
          imageUrl: "",
          images: [],
          isBestSeller: false,
          categoryId: null,
          lowStockThreshold: null,
          variants: [{ id: medium, attributes: { Size: "M" }, stock: 7, priceCentsOverride: null, imageUrl: null }],
        },
        actor,
      );
      assert.equal(
        await prisma.productVariant.count({ where: { id: small } }),
        0,
        "the variant really is hard-deleted; that is what makes the write-off the only record",
      );
      const writeOff = await prisma.stockMovement.findFirstOrThrow({
        where: { tenantId: T, reason: "VARIANT_REMOVED" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(writeOff.delta, -4, "the whole of what was on the shelf");
      assert.equal(writeOff.balanceAfter, 0);
      assert.equal(writeOff.variantId, null, "ON DELETE SET NULL nulled the link");
      assert.equal(
        writeOff.productNameSnapshot,
        "Two Options",
        "and the row is still readable, because the name travelled with it",
      );
      assert.deepEqual(writeOff.variantAttributesSnapshot, { Size: "S" });
      await assertNoDrift("after removing a variant");
    });

    console.log("\nTwo people counting one shelf:");
    await check("a stale absolute set is refused with the live figure, not applied", async () => {
      // Two staff open the same shelf. Both see 30.
      await setVariantStock(T, LV, 30, actor);
      const bothSaw = 30;
      // The first one counts 25 and saves.
      const first = await setVariantStock(T, LV, 25, actor, bothSaw);
      assert.equal(first.ok, true);

      // The second one counts 31 and saves, still comparing against the 30 on their screen. This
      // is the whole of D89: before it, this write landed and the first count vanished with no
      // error anywhere.
      const stale = await setVariantStock(T, LV, 31, actor, bothSaw);
      assert.equal(stale.ok, false, "the second save must be refused, not applied");
      assert.equal(stale.ok === false && stale.reason, "CHANGED");
      assert.equal(
        stale.ok === false && stale.reason === "CHANGED" && stale.current,
        25,
        "a refusal always states the live figure: 'try again' with no number is not an answer",
      );
      assert.equal(await stockOf(LV), 25, "and the loser's number was NOT written");
      assert.equal(
        await prisma.stockMovement.count({ where: { tenantId: T, balanceAfter: 31 } }),
        0,
        "nor did a refused write leave a movement claiming it happened",
      );
      await assertNoDrift("after a refused set");
    });

    await check("a caller with no earlier figure gets a plain set, and says so by omission", async () => {
      // Receiving goods computes its delta from the live stock inside the transaction, so it has
      // no screen figure to compare against. Omitting `expect` is the honest way to say that; it
      // must not be mistaken for a compare-and-swap that happens to always pass.
      const plain = await withTenant(T, (tx) =>
        setStockTo(tx, T, LV, 26, { ledger: { reason: "RECEIPT", actor } }),
      );
      assert.equal(plain.ok, true);
      assert.equal(await stockOf(LV), 26);
      const last = (await movements(LV)).at(-1)!;
      assert.equal(last.reason, "RECEIPT");
      assert.equal(last.delta, 1);
      await assertNoDrift("after a receipt-shaped set");
    });

    await check("another store's variant is NOT_FOUND, not CHANGED", async () => {
      const outcome = await setVariantStock(T, "not-a-variant-of-this-store", 5, actor);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok === false && outcome.reason, "NOT_FOUND");
    });

    console.log("\nSwitching the module off and on again:");
    await check("stock that moved while it was off is absorbed by a fresh OPENING", async () => {
      await setTenantStock(T, null);
      const before = await movements(LV);
      // The product form writes stock again while the module is off — exactly as it did before
      // this phase, which is the promise "off is as it was" makes.
      await setVariantStock(T, LV, 7, actor);
      assert.equal(await stockOf(LV), 7);
      assert.deepEqual(
        (await movements(LV)).map((r) => r.id),
        before.map((r) => r.id),
        "no movement is written while the module is off",
      );
      const gap = await drift();
      assert.equal(
        gap.length,
        1,
        "and the ledger now legitimately disagrees with the shelf: that is what an off-period IS",
      );

      await setTenantStock(T, OWNER);
      await setVariantStock(T, LV, 6, actor);
      const rows = await movements(LV);
      const opening = rows[rows.length - 2];
      const adjust = rows[rows.length - 1];
      assert.equal(opening.reason, "OPENING");
      assert.equal(
        opening.balanceAfter,
        7,
        "the first movement after the gap opens at what is ACTUALLY on the shelf, not at what " +
          "the ledger last said — summing deltas across a gap would have been wrong forever",
      );
      assert.equal(adjust.reason, "ADJUST");
      assert.equal(adjust.balanceAfter, 6);
      assert.ok(
        before.length > 0 && rows.slice(0, before.length).every((r, i) => r.id === before[i].id),
        "and every row from before the gap is still there, unchanged and readable",
      );
      await assertNoDrift("after the module came back on");
    });

    console.log("\nUnder concurrency:");
    await check("a sale and a correction racing on one variant both land, and the ledger holds", async () => {
      await setVariantStock(T, LV, 50, actor);
      const results = await Promise.allSettled([
        placeOrder(T, customer, [{ variantId: LV, quantity: 5 }]),
        setVariantStock(T, LV, 40, actor),
        recordCounterSale(T, {
          submissionId: `ledger-${RUN}-race`,
          payment: "CARD",
          lines: [{ variantId: LV, quantity: 2 }],
          soldByUserId: OWNER,
          soldByName: "Stock Owner",
          role: "STORE_OWNER",
        }),
      ]);
      // Each of the three may legitimately lose: the correction is a compare-and-swap, and a sale
      // can run short. What may NOT happen is a movement that disagrees with the shelf.
      assert.ok(
        results.some((r) => r.status === "fulfilled"),
        `at least one had to get through: ${JSON.stringify(results.map((r) => r.status))}`,
      );
      await assertNoDrift("after three writers raced on one variant");
      const rows = await movements(LV);
      assert.deepEqual(
        rows.map((r) => r.variantSeq),
        rows.map((_, i) => i + 1),
        "and the per-variant counter is still dense and unique, which is the race's real target",
      );
    });

    await check("the void's restored lines are recorded once, not again on a replay", async () => {
      const voided = await prisma.stockMovement.count({
        where: { tenantId: T, reason: "COUNTER_VOID", counterSaleId: voidedSaleId },
      });
      assert.equal(voided, 1, "one void, one movement");
    });

    // =======================================================================================
    // Receiving and stocktaking (C5)
    // =======================================================================================
    console.log("\nReceiving a delivery:");
    const batchActor = { userId: OWNER, name: "Stock Owner" };
    const sub = (suffix: string) => `batch-${RUN}-${suffix}`;

    const receiveA = await product("Receive Me", 5);
    const RA = receiveA.variants[0].id;
    const receiveB = await product("Receive Me Too", 0);
    const RB = receiveB.variants[0].id;

    await check("every line goes up by what arrived, and the ledger reconciles", async () => {
      const batch = await recordStockReceipt(T, {
        submissionId: sub("r1"),
        reference: "DN-4417",
        note: "two boxes",
        actor: batchActor,
        lines: [
          { variantId: RA, quantity: 12, unitCostCents: 450 },
          { variantId: RB, quantity: 3, unitCostCents: 1200 },
        ],
      });
      assert.equal(batch.idempotent, false);
      assert.equal(await stockOf(RA), 17, "5 + 12");
      assert.equal(await stockOf(RB), 3, "0 + 3");

      const lines = await prisma.stockMovement.findMany({
        where: { tenantId: T, batchId: batch.id, reason: "RECEIPT" },
        orderBy: { productNameSnapshot: "asc" },
      });
      assert.equal(lines.length, 2, "one movement per line, naming the document");
      assert.deepEqual(
        lines.map((l) => [l.delta, l.balanceAfter, l.unitCostCents]),
        [[12, 17, 450], [3, 3, 1200]],
        "and each carries ITS OWN cost: one delivery is one moment at several prices",
      );
      const header = await prisma.stockBatch.findUniqueOrThrow({ where: { id: batch.id } });
      assert.equal(header.kind, "RECEIPT");
      assert.equal(header.reference, "DN-4417");
      assert.equal(header.actorNameSnapshot, "Stock Owner");
      await assertNoDrift("after a delivery");
    });

    await check("a replayed submission returns the first document and writes nothing new", async () => {
      const before = await prisma.stockMovement.count({ where: { tenantId: T } });
      const first = await recordStockReceipt(T, {
        submissionId: sub("r2"),
        actor: batchActor,
        lines: [{ variantId: RA, quantity: 2 }],
      });
      const after = await stockOf(RA);
      const again = await recordStockReceipt(T, {
        submissionId: sub("r2"),
        actor: batchActor,
        lines: [{ variantId: RA, quantity: 2 }],
      });
      assert.equal(again.id, first.id, "the same document comes back");
      assert.equal(again.idempotent, true, "and says so, so the screen does not claim a second one");
      assert.equal(await stockOf(RA), after, "the shelf moved once");
      assert.equal(
        await prisma.stockMovement.count({ where: { tenantId: T } }),
        before + 1,
        "and exactly one movement exists for it: a retry is a success, not a second delivery",
      );
      await assertNoDrift("after a replay");
    });

    await check("the same id with different lines is refused, not answered", async () => {
      await recordStockReceipt(T, {
        submissionId: sub("r3"),
        actor: batchActor,
        lines: [{ variantId: RA, quantity: 1 }],
      });
      const shelf = await stockOf(RA);
      await assert.rejects(
        recordStockReceipt(T, {
          submissionId: sub("r3"),
          actor: batchActor,
          lines: [{ variantId: RA, quantity: 9 }],
        }),
        (error: unknown) =>
          error instanceof StockBatchError && error.code === "SUBMISSION_REUSED",
        "answering with the first document would silently lose nine units",
      );
      assert.equal(await stockOf(RA), shelf, "and nothing moved");
    });

    await check("two lines of the same option are one movement, as the screen shows them", async () => {
      const shelf = await stockOf(RB);
      const batch = await recordStockReceipt(T, {
        submissionId: sub("r4"),
        actor: batchActor,
        lines: [
          { variantId: RB, quantity: 4, unitCostCents: 100 },
          { variantId: RB, quantity: 6, unitCostCents: 999 },
        ],
      });
      assert.equal(await stockOf(RB), shelf + 10);
      const lines = await prisma.stockMovement.findMany({
        where: { tenantId: T, batchId: batch.id },
      });
      assert.equal(
        lines.length,
        1,
        "one variant cannot hold two positions in its own counter for one document",
      );
      assert.equal(lines[0].delta, 10);
      assert.equal(lines[0].unitCostCents, 100, "the first price given stands");
      await assertNoDrift("after a merged line");
    });

    await check("a document is capped, and an empty one is refused", async () => {
      await assert.rejects(
        recordStockReceipt(T, {
          submissionId: sub("r5"),
          actor: batchActor,
          lines: Array.from({ length: MAX_STOCK_LINES + 1 }, () => ({
            variantId: RA,
            quantity: 1,
          })),
        }),
        (error: unknown) => error instanceof StockBatchError && error.code === "INVALID",
      );
      await assert.rejects(
        recordStockReceipt(T, { submissionId: sub("r6"), actor: batchActor, lines: [] }),
        (error: unknown) => error instanceof StockBatchError && error.code === "EMPTY",
      );
      assert.equal(
        await prisma.stockBatch.count({ where: { tenantId: T, submissionId: sub("r5") } }),
        0,
        "a refused document leaves no header behind",
      );
    });

    console.log("\nCounting a shelf:");
    await check("a count of 8 against 10 records the variance it actually found", async () => {
      const counted = await product("Count Me", 10);
      const CV = counted.variants[0].id;
      const batch = await recordStocktake(T, {
        submissionId: sub("c1"),
        reference: "Aisle 3",
        actor: batchActor,
        lines: [{ variantId: CV, counted: 8 }],
      });
      assert.deepEqual(
        batch.applied.map((a) => [a.from, a.to, a.delta]),
        [[10, 8, -2]],
        "the server computes the difference from what it found, not from what a screen sent",
      );
      assert.equal(await stockOf(CV), 8);
      const [row] = await prisma.stockMovement.findMany({
        where: { tenantId: T, batchId: batch.id },
      });
      assert.equal(row.reason, "COUNT");
      assert.equal(row.delta, -2);
      assert.equal(row.balanceAfter, 8);
      await assertNoDrift("after a count");
    });

    await check("a line that agrees still writes a zero-delta row: it is the evidence", async () => {
      const agrees = await product("Agrees", 6);
      const AV = agrees.variants[0].id;
      const batch = await recordStocktake(T, {
        submissionId: sub("c2"),
        actor: batchActor,
        lines: [{ variantId: AV, counted: 6 }],
      });
      const rows = await prisma.stockMovement.findMany({
        where: { tenantId: T, batchId: batch.id },
      });
      assert.equal(rows.length, 1, "a count that found nothing wrong is still a count");
      assert.equal(rows[0].delta, 0);
      assert.equal(rows[0].balanceAfter, 6);
      assert.equal(rows[0].reason, "COUNT");
      await assertNoDrift("after an agreeing count");
    });

    await check("counting a shelf to zero is a real count, not an empty line", async () => {
      const gone = await product("All Gone", 4);
      const GV = gone.variants[0].id;
      await recordStocktake(T, {
        submissionId: sub("c3"),
        actor: batchActor,
        lines: [{ variantId: GV, counted: 0 }],
      });
      assert.equal(await stockOf(GV), 0);
      await assertNoDrift("after counting a shelf empty");
    });

    await check("a sale landing during a count leaves the ledger intact", async () => {
      const busy = await product("Busy Shelf", 40);
      const BV = busy.variants[0].id;
      // The count locks the rows it is about to replace, so the sale either commits before the
      // lock (and the count's `from` includes it) or waits for the count. What must never happen
      // is a movement whose delta describes a discrepancy that was never on the shelf.
      const [count] = await Promise.allSettled([
        recordStocktake(T, {
          submissionId: sub("c4"),
          actor: batchActor,
          lines: [{ variantId: BV, counted: 30 }],
        }),
        placeOrder(T, customer, [{ variantId: BV, quantity: 5 }]),
      ]);
      assert.equal(count.status, "fulfilled", "the count must not be the casualty");
      await assertNoDrift("after a sale during a count");
      const rows = await movements(BV);
      assert.deepEqual(
        rows.map((r) => r.variantSeq),
        rows.map((_, i) => i + 1),
        "and the per-variant counter is still dense",
      );
      // Every movement's balance must be explainable by the one before it.
      for (let i = 1; i < rows.length; i++) {
        assert.equal(
          rows[i].balanceAfter,
          rows[i - 1].balanceAfter + rows[i].delta,
          `movement ${rows[i].variantSeq} does not follow from the one before it: a delta that ` +
            "does not bridge two balances is a discrepancy the ledger invented",
        );
      }
    });

    console.log("\nWhat stock cost is the owner's:");
    await check("a staff member's posted cost is dropped, and an owner's is kept", async () => {
      // The enforcing half of D92, as a pure rule so it can be tested without a session. The
      // action calls exactly this, and the check below holds that down.
      assert.equal(costForRole("STAFF", 4500), null, "staff never store a cost, whatever is posted");
      assert.equal(costForRole("STAFF", null), null);
      assert.equal(costForRole("STORE_OWNER", 4500), 4500);
      assert.equal(costForRole("STORE_OWNER", undefined), null, "and an absent cost stays absent");

      const source = readFileSync("app/admin/(panel)/stock/actions.ts", "utf8");
      assert.match(
        source,
        /unitCostCents: costForRole\(member\.role, line\.unitCostCents\)/,
        "the action must go through the rule rather than reading the posted figure directly — " +
          "the form hiding the field for staff is a courtesy, this is the check",
      );
    });

    console.log("\nThe module's switch gates the writer, not just the screen:");
    await check("a store with the module off cannot submit a document", async () => {
      await setTenantStock(T, null);
      const shelf = await stockOf(RA);
      for (const attempt of [
        () =>
          recordStockReceipt(T, {
            submissionId: sub("off1"),
            actor: batchActor,
            lines: [{ variantId: RA, quantity: 5 }],
          }),
        () =>
          recordStocktake(T, {
            submissionId: sub("off2"),
            actor: batchActor,
            lines: [{ variantId: RA, counted: 1 }],
          }),
      ]) {
        await assert.rejects(
          attempt(),
          (error: unknown) => error instanceof StockBatchError && error.code === "FEATURE_OFF",
          "a server action is its own HTTP endpoint: the page's gate does not protect it",
        );
      }
      assert.equal(await stockOf(RA), shelf, "and a refused document moves nothing");
      assert.equal(
        await prisma.stockBatch.count({ where: { tenantId: T, submissionId: sub("off1") } }),
        0,
      );
      await setTenantStock(T, OWNER);
    });

    // =======================================================================================
    // The six defects a browser walkthrough found, each with its own leg (C7)
    // =======================================================================================
    //
    // Every one of these was reachable through the real UI and none of the suites caught it. They
    // are written here so that fixing them is permanent rather than this week's state.
    console.log("\nThe six defects found by walking the UI:");

    await check("deleting a product writes off the stock it still held", async () => {
      // THE gap: updateProduct wrote a VARIANT_REMOVED before deleting a variant removed from the
      // form, and deleting the whole PRODUCT — the most direct way to destroy stock — cascaded its
      // variants away silently. The ledger's newest movement for that variant went on claiming the
      // old figure for ever, so the invariant could never reconcile it.
      const doomed = await product("Doomed Product", 9);
      const variantId = doomed.variants[0].id;
      await setVariantStock(T, variantId, 9, actor, 9);
      const before = await prisma.stockMovement.count({ where: { tenantId: T } });

      assert.equal(await deleteProduct(T, doomed.id, actor), true);
      assert.equal(
        await prisma.productVariant.count({ where: { id: variantId } }),
        0,
        "the variant really is gone; that is what makes the write-off the only record",
      );
      const written = await prisma.stockMovement.findFirstOrThrow({
        where: { tenantId: T, reason: "VARIANT_REMOVED", productNameSnapshot: "Doomed Product" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(written.delta, -9, "the whole of what was on the shelf");
      assert.equal(written.balanceAfter, 0);
      assert.equal(written.variantId, null, "ON DELETE SET NULL nulled the link");
      assert.equal(written.actorUserId, OWNER, "and it names who deleted it");
      assert.ok(
        (await prisma.stockMovement.count({ where: { tenantId: T } })) > before,
        "a row was added rather than the stock quietly vanishing",
      );
      await assertNoDrift("after deleting a whole product");
    });

    await check("a receipt that would overfill a shelf is refused, and nothing is saved", async () => {
      const brim = await product("Nearly Full", MAX_STOCK - 5);
      const BV = brim.variants[0].id;
      await assert.rejects(
        recordStockReceipt(T, {
          submissionId: sub("cap1"),
          actor: batchActor,
          lines: [{ variantId: BV, quantity: 100 }],
        }),
        (error: unknown) => error instanceof StockBatchError && error.code === "OVER_CAPACITY",
        "receiving used to have no ceiling at all, so a shelf could be pushed to twice MAX_STOCK " +
          "— a figure the stock screen then refused to save, trapping it",
      );
      assert.equal(await stockOf(BV), MAX_STOCK - 5, "and the shelf did not move");
      assert.equal(
        await prisma.stockBatch.count({ where: { tenantId: T, submissionId: sub("cap1") } }),
        0,
        "nor was a document left behind",
      );
      // Right up to the ceiling is still allowed: the cap is a limit, not a margin.
      const ok = await recordStockReceipt(T, {
        submissionId: sub("cap2"),
        actor: batchActor,
        lines: [{ variantId: BV, quantity: 5 }],
      });
      assert.ok(ok.id);
      assert.equal(await stockOf(BV), MAX_STOCK);
      await assertNoDrift("after filling a shelf exactly");
    });

    await check("a restore is NEVER refused by the ceiling, however full the shelf", async () => {
      // The cap deliberately does not live in incrementStock, which is also how a cancellation and
      // a void give stock back. A restore that could be refused would mean a cancelled order
      // keeping units it took, which is worse than any ceiling.
      const full = await product("Brim Full", MAX_STOCK);
      const FV = full.variants[0].id;
      const order = await placeOrder(T, customer, [{ variantId: FV, quantity: 3 }]);
      assert.equal(await stockOf(FV), MAX_STOCK - 3);
      await updateOrderStatus(T, order.id, "CANCELLED", actor);
      assert.equal(
        await stockOf(FV),
        MAX_STOCK,
        "the cancellation put all three back, right up to the ceiling",
      );
      await assertNoDrift("after restoring onto a full shelf");
    });

    await check("a document naming a vanished option is refused whole, not partly applied", async () => {
      const keep = await product("Still Here", 10);
      const going = await product("About To Go", 10);
      const KV = keep.variants[0].id;
      const GV = going.variants[0].id;
      await prisma.product.deleteMany({ where: { id: going.id } });

      for (const [label, attempt] of [
        [
          "a receipt",
          () =>
            recordStockReceipt(T, {
              submissionId: sub("gone1"),
              actor: batchActor,
              lines: [
                { variantId: KV, quantity: 1 },
                { variantId: GV, quantity: 1 },
              ],
            }),
        ],
        [
          "a stocktake",
          () =>
            recordStocktake(T, {
              submissionId: sub("gone2"),
              actor: batchActor,
              lines: [
                { variantId: KV, counted: 1 },
                { variantId: GV, counted: 1 },
              ],
            }),
        ],
      ] as const) {
        await assert.rejects(
          attempt(),
          (error: unknown) => error instanceof StockBatchError && error.code === "UNAVAILABLE",
          `${label} used to apply the surviving lines and report the submitted count, so two ` +
            `lines read as "2 lines received" over a document holding one`,
        );
      }
      assert.equal(await stockOf(KV), 10, "and the surviving shelf did not move either");
      await assertNoDrift("after a refused document");
    });

    await check("a count may always name what is on the shelf, whatever the ceiling", async () => {
      // The form pre-fills each line with the shelf figure. A ceiling below it made the form
      // declare its own pre-fill invalid — "agrees" and "enter a whole number" at once, submit
      // disabled — which left nobody able to count that shelf at all.
      assert.equal(countedCeiling(10), MAX_STOCK, "a normal shelf is measured against the ceiling");
      assert.equal(
        countedCeiling(MAX_STOCK * 2),
        MAX_STOCK * 2,
        "and a shelf already above it may still be counted as found",
      );
      // The server agrees with that rule, so the form is not alone in it.
      const legacy = await product("Legacy Overfull", 10);
      const LV = legacy.variants[0].id;
      // Straight past both writers, the way pre-fix data got there.
      await prisma.productVariant.update({ where: { id: LV }, data: { stock: MAX_STOCK + 50 } });
      const counted = await recordStocktake(T, {
        submissionId: sub("legacy"),
        actor: batchActor,
        lines: [{ variantId: LV, counted: MAX_STOCK + 50 }],
      });
      assert.equal(counted.applied[0].delta, 0, "counting it as found is a zero-delta row");
      // And a count may still not INVENT a figure above the ceiling.
      await assert.rejects(
        recordStocktake(T, {
          submissionId: sub("legacy2"),
          actor: batchActor,
          lines: [{ variantId: LV, counted: MAX_STOCK + 51 }],
        }),
        (error: unknown) => error instanceof StockBatchError && error.code === "OVER_CAPACITY",
      );
    });

    await check("a malformed money figure is refused, not silently truncated", () => {
      // Number.parseFloat stops at the second decimal point and returns what it has, so "4.5.6"
      // came back 4.5 and was stored as $4.50 — a money field keeping a different number than the
      // one typed, with nothing on screen to say so.
      assert.equal(parseStockCostCents("4.5.6"), null, "the defect, now refused");
      assert.equal(parseStockCostCents("4,5,6"), null);
      assert.equal(parseStockCostCents("-5"), null);
      assert.equal(parseStockCostCents("4.567"), null, "more precision than money has");
      assert.equal(parseStockCostCents("abc"), null);
      assert.equal(parseStockCostCents(""), null, "blank is no cost, which is not an error");
      // And everything a person legitimately types still works.
      assert.equal(parseStockCostCents("4"), 400);
      assert.equal(parseStockCostCents("4.5"), 450);
      assert.equal(parseStockCostCents("4.50"), 450);
      assert.equal(parseStockCostCents("4,50"), 450, "a comma is a decimal mark in Arabic too");
      assert.equal(parseStockCostCents(".5"), 50);
      assert.equal(parseStockCostCents("4."), 400);
      // The quantity parser shares the discipline.
      assert.equal(parseStockWhole("12"), 12);
      assert.equal(parseStockWhole("012"), 12);
      assert.equal(parseStockWhole("1.5"), null);
      assert.equal(parseStockWhole("-1"), null);
      assert.equal(parseStockWhole(""), null);
      return Promise.resolve();
    });

    // =======================================================================================
    // Isolation, as the restricted role (C6)
    // =======================================================================================
    console.log("\nAnother store's ledger is unreachable (as app_user, in a subprocess):");
    await check("store B can neither read nor write store A's movements and documents", async () => {
      // This suite connects as the OWNER (scripts/_owner), which is a superuser and bypasses RLS,
      // so every assertion above measures the application's WHERE clauses alone. The database half
      // only means something from a restricted role, which needs its own process because
      // APP_DATABASE_URL is read once at module load.
      const ownerUrl = process.env.DATABASE_URL;
      assert.ok(ownerUrl, "DATABASE_URL is needed to read the restricted role's URL from .env");
      const appUrl = parseEnvFile(readFileSync(".env", "utf8")).APP_DATABASE_URL;
      assert.ok(
        appUrl && new URL(appUrl).username !== new URL(ownerUrl).username,
        "APP_DATABASE_URL must point at a restricted role for this check to mean anything",
      );

      // A second store, and a document of this store's to aim at.
      const other = await createStoreWithOwner({
        storeName: `Stock Other ${RUN}`,
        ownerName: "Other",
        ownerEmail: `stock-other-${RUN}@example.test`,
        passwordHash: "x",
      });
      try {
        const batchOfA = await prisma.stockBatch.findFirstOrThrow({
          where: { tenantId: T },
          select: { id: true },
        });
        // B needs a variant of its OWN for the foreign-batch probe to ask anything. Without one
        // the insert is refused by `StockMovement_variantId_fkey` and the probe reports "refused"
        // while having tested nothing about documents — which is how it read on its first run.
        const productOfB = await createProduct(
          other.tenant.id,
          base({ name: "Other Store Thing" }),
        );
        const probeVariant = productOfB.variants[0].id;

        const child = spawnSync(
          `npx tsx scripts/fixtures/stock-cross-tenant.ts ${other.tenant.id} ${T} ${batchOfA.id} ${probeVariant}`,
          { shell: true, encoding: "utf8", env: { ...process.env, APP_DATABASE_URL: appUrl } },
        );
        const line = (child.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}";
        const result = JSON.parse(line) as {
          role?: { current_user: string; rolsuper: boolean; rolbypassrls: boolean };
          probes?: { name: string; leakedRows?: number; refused: boolean; error: string }[];
          threw?: string;
        };
        assert.ok(!result.threw, `the fixture failed: ${result.threw} ${child.stderr}`);
        assert.ok(result.role, `the fixture reported no role: ${line}`);
        assert.equal(result.role.rolsuper, false, "the fixture must not run as a superuser");
        assert.equal(result.role.rolbypassrls, false, "and must not bypass RLS");

        const byName = new Map((result.probes ?? []).map((probe) => [probe.name, probe]));
        assert.equal(
          byName.get("read")?.leakedRows,
          0,
          "another store's ledger and documents were readable",
        );
        for (const name of ["write-movement", "write-batch"] as const) {
          assert.equal(byName.get(name)?.refused, true, `a ${name} for another store SUCCEEDED`);
          assert.match(
            byName.get(name)?.error ?? "",
            /row-level security|violates/i,
            `${name} was refused for the wrong reason (${byName.get(name)?.error})`,
          );
        }
        // The foreign-batch probe is reported rather than asserted either way: see the fixture's
        // header, and KNOWN_GAPS.md. What the suite holds down is that it cannot be used to READ
        // anything — a movement filed against another store's document is still this store's row,
        // and the other store's document stays invisible.
        const foreign = byName.get("foreign-batch");
        assert.ok(foreign, "the foreign-batch probe did not report");
        console.log(
          `      note: filing a movement against another store's document was ` +
            `${foreign.refused ? "refused" : "ACCEPTED"}${foreign.error ? ` (${foreign.error})` : ""}` +
            ` — see KNOWN_GAPS.md`,
        );
      } finally {
        await prisma.tenant.deleteMany({ where: { id: other.tenant.id } });
        await prisma.user.deleteMany({ where: { id: other.user.id } });
      }
    });

    console.log("\nThe seam the ledger depends on:");
    await check("stock still moves in exactly one file, and the ledger is written there", () => {
      // `verify:counter` makes this same assertion, and it is repeated here deliberately rather
      // than left to it. The whole of this phase rests on it: a writer that changes stock outside
      // lib/data/stock.ts gets no movement row, and the ledger would be quietly incomplete rather
      // than wrong — the failure that passes every other check. A suite that cannot finish without
      // push keys configured is not where that guarantee should live alone.
      for (const [label, pattern] of [
        ["a conditional decrement", "stock: { decrement"],
        ["a stock floor guard", "stock: { gte"],
        ["a stock increment", "stock: { increment"],
      ] as const) {
        assert.deepEqual(
          gitGrepFiles(pattern),
          ["lib/data/stock.ts"],
          `${label} must exist only in lib/data/stock.ts`,
        );
      }
      // And the movement writer with it, so the two cannot be separated by a refactor that
      // moves one and leaves the other behind.
      const source = readFileSync("lib/data/stock.ts", "utf8");
      assert.match(source, /export async function recordStockMovements\(/);
      assert.deepEqual(
        gitGrepFiles("stockMovement.createMany"),
        ["lib/data/stock.ts"],
        "a movement row is inserted in one place, beside the UPDATE that justifies it",
      );
      return Promise.resolve();
    });
  } finally {
    await prisma.notificationAlertState.deleteMany({ where: { tenantId: T } });
    // StockMovement/StockBatch cascade from Tenant, so they need no line of their own here —
    // which is also the thing worth having said once: a store's deletion takes its ledger.
    await prisma.tenant.deleteMany({ where: { id: T } });
    await prisma.user.deleteMany({ where: { id: OWNER } });
  }

  console.log(`\nAll ${checks} stock checks passed (test store removed).`);
}

/** The same shape verify:counter uses: .env is read directly, not through process.env. */
function parseEnvFile(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

main()
  .catch((e) => {
    console.error("\nSTOCK CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
