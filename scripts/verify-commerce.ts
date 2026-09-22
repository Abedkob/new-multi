/**
 * Catalog + order data-layer checks (pnpm verify:commerce). Creates two throwaway stores,
 * exercises categories (and, as they land, variants, stock and orders), including attacks
 * from the other store, then removes everything.
 */
import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { descendantIds, flattenCategories } from "../lib/categories";
import {
  CategoryError,
  createCategory,
  deleteCategory,
  getCategoryBySlug,
  listCategories,
  updateCategory,
} from "../lib/data/categories";
import {
  ProductError,
  createProduct,
  deleteProduct,
  getProduct,
  getVariantsForStore,
  updateProduct,
  type ProductInput,
} from "../lib/data/products";
import {
  OrderError,
  getOrder,
  listOrders,
  placeOrder,
  updateOrderStatus,
} from "../lib/data/orders";
import { orderTotal } from "../lib/orders";
import { createStoreWithOwner } from "../lib/data/tenants";
import { toStoreProduct } from "../lib/store-product";
import { cartLinesSchema, checkoutSchema, productFormSchema } from "../lib/validation";
import { variantSetIssues } from "../lib/variants";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const rejects = (p: Promise<unknown>, pattern: RegExp) =>
  assert.rejects(p, (e) => e instanceof CategoryError && pattern.test(e.message));

async function main() {
  const run = Date.now().toString(36);
  const mk = (n: string) =>
    createStoreWithOwner({
      storeName: `Commerce ${n} ${run}`,
      ownerName: n,
      ownerEmail: `commerce-${n.toLowerCase()}-${run}@example.test`,
      passwordHash: "x",
    });
  const a = await mk("A");
  const b = await mk("B");
  const A = a.tenant.id;
  const B = b.tenant.id;

  try {
    console.log("Categories:");
    const men = await createCategory(A, { name: "Men", parentId: null });
    const shoes = await createCategory(A, { name: "Shoes", parentId: men.id });
    const nike = await createCategory(A, { name: "Nike", parentId: shoes.id });
    const topShoes = await createCategory(A, { name: "Shoes", parentId: null }); // Shoes -> Nike style
    const topNike = await createCategory(A, { name: "Nike", parentId: topShoes.id });

    await check("nested tree renders in order with depth and full paths (Men > Shoes > Nike)", async () => {
      const flat = flattenCategories(await listCategories(A));
      const paths = flat.map((c) => `${c.depth}:${c.path}`);
      assert.deepEqual(paths, [
        "0:Men",
        "1:Men / Shoes",
        "2:Men / Shoes / Nike",
        "0:Shoes",
        "1:Shoes / Nike",
      ]);
    });

    await check("slugs are unique within a store (duplicate names get -2, -3)", async () => {
      assert.equal(men.slug, "men");
      assert.equal(shoes.slug, "shoes");
      assert.equal(topShoes.slug, "shoes-2");
      assert.equal(nike.slug, "nike");
      assert.equal(topNike.slug, "nike-2");
      assert.equal((await getCategoryBySlug(A, "shoes-2"))?.id, topShoes.id);
    });

    await check("descendants of a category include the whole subtree (for shop-by-category)", async () => {
      const all = await listCategories(A);
      assert.deepEqual([...descendantIds(all, men.id)].sort(), [men.id, shoes.id, nike.id].sort());
      assert.deepEqual([...descendantIds(all, nike.id)], [nike.id]);
    });

    await check("the same name in another store gets its own (unsuffixed) slug", async () => {
      const other = await createCategory(B, { name: "Men", parentId: null });
      assert.equal(other.slug, "men");
      assert.equal((await getCategoryBySlug(A, "men"))?.id, men.id);
    });

    await check("cannot move a category inside itself or its own descendants (no loops)", async () => {
      await rejects(updateCategory(A, men.id, { name: "Men", parentId: men.id }), /inside itself/);
      await rejects(updateCategory(A, men.id, { name: "Men", parentId: nike.id }), /inside itself/);
      await rejects(updateCategory(A, shoes.id, { name: "Shoes", parentId: nike.id }), /inside itself/);
      // A legal move still works, and a rename keeps the slug.
      await updateCategory(A, nike.id, { name: "Nike Air", parentId: men.id });
      const moved = flattenCategories(await listCategories(A)).find((c) => c.id === nike.id)!;
      assert.equal(moved.path, "Men / Nike Air");
      assert.equal(moved.slug, "nike");
      await updateCategory(A, nike.id, { name: "Nike", parentId: shoes.id });
    });

    await check("store B cannot use, edit or delete store A's categories", async () => {
      await rejects(createCategory(B, { name: "Sneaky", parentId: men.id }), /parent category doesn't exist/);
      await rejects(updateCategory(B, men.id, { name: "HACKED", parentId: null }), /not found/i);
      await rejects(deleteCategory(B, men.id), /not found/i);
      assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: men.id } })).name, "Men");
    });

    await check("deleting a category with subcategories is blocked with a clear message", async () => {
      await rejects(deleteCategory(A, men.id), /"Men" has 1 subcategory\. Move or delete it first/);
      await rejects(deleteCategory(A, shoes.id), /"Shoes" has 1 subcategory/);
      assert.ok(await prisma.category.findUnique({ where: { id: men.id } }));
    });

    await check("deleting a category with products is blocked with a clear message", async () => {
      const product = await prisma.product.create({
        data: { tenantId: A, name: "Air", slug: "air", basePriceCents: 100, categoryId: topNike.id },
      });
      await rejects(deleteCategory(A, topNike.id), /"Nike" has 1 product assigned/);
      assert.ok(await prisma.category.findUnique({ where: { id: topNike.id } }));
      await prisma.product.delete({ where: { id: product.id } });
    });

    await check("empty leaf categories delete fine, then their parents can too", async () => {
      await deleteCategory(A, topNike.id);
      await deleteCategory(A, topShoes.id);
      await deleteCategory(A, nike.id);
      await deleteCategory(A, shoes.id);
      await deleteCategory(A, men.id);
      assert.equal((await listCategories(A)).length, 0);
    });


    console.log("Variants:");
    const v = (attributes: Record<string, string>, stock = 5, price: number | null = null, img: string | null = null) => ({
      attributes,
      stock,
      priceCentsOverride: price,
      imageUrl: img,
    });
    const base = (over: Partial<ProductInput> = {}): ProductInput => ({
      name: "Thing",
      description: "",
      basePriceCents: 10000,
      imageUrl: "/base.svg",
      images: [],
      isBestSeller: false,
      categoryId: null,
      variants: [v({})],
      ...over,
    });
    const productErr = (p: Promise<unknown>, pattern: RegExp) =>
      assert.rejects(p, (e) => e instanceof ProductError && pattern.test(e.message));

    let shirt: Awaited<ReturnType<typeof createProduct>>;
    let mug: Awaited<ReturnType<typeof createProduct>>;

    await check("products with different attribute sets coexist (size+color, just size, none)", async () => {
      shirt = await createProduct(A, base({
        name: "Shirt",
        variants: [
          v({ size: "S", color: "White" }, 3),
          v({ size: "M", color: "White" }, 0),
          v({ size: "M", color: "Black" }, 4, 12000, "/black.svg"),
        ],
      }));
      mug = await createProduct(A, base({ name: "Mug", variants: [v({ size: "small" }, 2), v({ size: "large" }, 6, 15000)] }));
      const plain = await createProduct(A, base({ name: "Poster" }));
      assert.equal(shirt.variants.length, 3);
      assert.equal(mug.variants.length, 2);
      assert.equal(plain.variants.length, 1);
      assert.deepEqual(plain.variants[0].attributes, {});
    });

    await check("a product must have at least one variant (create and update)", async () => {
      await productErr(createProduct(A, base({ name: "Empty", variants: [] })), /at least one variant/);
      assert.equal(await prisma.product.count({ where: { tenantId: A, name: "Empty" } }), 0);
      await productErr(updateProduct(A, mug.id, base({ name: "Mug", variants: [] })), /at least one variant/);
      assert.equal((await getProduct(A, mug.id))!.variants.length, 2);
    });

    await check("several variants must share attribute names, differ, and each have an attribute", async () => {
      await productErr(createProduct(A, base({ name: "X1", variants: [v({ size: "S" }), v({ size: "S", color: "Red" })] })), /same attribute names/);
      await productErr(createProduct(A, base({ name: "X2", variants: [v({ size: "S" }), v({ size: "s" })] })), /Same attributes as variant 1/);
      await productErr(createProduct(A, base({ name: "X3", variants: [v({ size: "S" }), v({})] })), /at least one attribute/);
      assert.equal(variantSetIssues([{ attributes: { a: "1" } }, { attributes: { b: "1" } }]).length, 1);
      assert.equal(variantSetIssues([{ attributes: {} }]).length, 0); // single default variant is fine
      assert.equal(await prisma.product.count({ where: { tenantId: A, name: { in: ["X1", "X2", "X3"] } } }), 0);
    });

    await check("form validation: blank attribute names/values, bad stock and bad prices are rejected", async () => {
      const form = (variants: object[]) =>
        productFormSchema.safeParse({ name: "P", description: "", price: "10", imageUrl: "", isBestSeller: false, categoryId: "", variants });
      const good = { attributes: [{ key: "size", value: "M" }], stock: "3", price: "", imageUrl: "" };
      assert.ok(form([good]).success);
      assert.ok(form([{ ...good, attributes: [{ key: "", value: "" }] }]).success, "untouched blank row is ignored");
      assert.ok(!form([{ ...good, attributes: [{ key: "size", value: "" }] }]).success);
      assert.ok(!form([{ ...good, attributes: [{ key: "", value: "M" }] }]).success);
      assert.ok(!form([{ ...good, attributes: [{ key: "size", value: "M" }, { key: "Size", value: "L" }] }]).success);
      assert.ok(!form([{ ...good, stock: "-1" }]).success);
      assert.ok(!form([{ ...good, stock: "1.5" }]).success);
      assert.ok(!form([{ ...good, price: "abc" }]).success);
      assert.ok(!form([{ ...good, imageUrl: "javascript:alert(1)" }]).success);
      assert.ok(!form([]).success);
    });

    await check("variant price and image fall back to the product's when not overridden", async () => {
      const sp = toStoreProduct((await getProduct(A, shirt.id))!);
      const byLabel = Object.fromEntries(sp.variants.map((x) => [x.label, x]));
      assert.equal(byLabel["size: S, color: White"].priceCents, 10000);
      assert.equal(byLabel["size: S, color: White"].imageUrl, "/base.svg");
      assert.equal(byLabel["size: M, color: Black"].priceCents, 12000);
      assert.equal(byLabel["size: M, color: Black"].imageUrl, "/black.svg");
      assert.equal(sp.priceCents, 10000); // "from" price
      assert.equal(sp.hasPriceRange, true);
      assert.equal(sp.inStock, true);
    });

    await check("stock is per variant: a product is only 'out of stock' when every variant is", async () => {
      const oneOut = toStoreProduct((await getProduct(A, shirt.id))!);
      assert.equal(oneOut.variants.find((x) => x.label === "size: M, color: White")!.stock, 0);
      assert.equal(oneOut.inStock, true);
      const allOut = await createProduct(A, base({ name: "Gone", variants: [v({ size: "S" }, 0), v({ size: "M" }, 0)] }));
      assert.equal(toStoreProduct(allOut).inStock, false);
    });

    await check("updating a product keeps variant ids, adds new rows and deletes removed ones", async () => {
      const before = (await getProduct(A, shirt.id))!.variants;
      const [s1, m1] = [before[0], before[1]];
      await updateProduct(A, shirt.id, base({
        name: "Shirt",
        variants: [
          { ...v({ size: "S", color: "White" }, 9), id: s1.id },
          { ...v({ size: "M", color: "White" }, 1), id: m1.id },
          v({ size: "L", color: "White" }, 7), // new
        ], // the Black one was removed
      }));
      const after = (await getProduct(A, shirt.id))!.variants;
      assert.equal(after.length, 3);
      assert.deepEqual(after.slice(0, 2).map((x) => x.id), [s1.id, m1.id]);
      assert.equal(after[0].stock, 9);
      assert.ok(!after.some((x) => x.id === before[2].id), "removed variant should be gone");
    });

    await check("store B cannot read, edit or delete store A's products or variants", async () => {
      const variantId = (await getProduct(A, mug.id))!.variants[0].id;
      assert.equal(await getProduct(B, mug.id), null);
      assert.deepEqual(await getVariantsForStore(B, [variantId]), []);
      assert.equal((await getVariantsForStore(A, [variantId])).length, 1);
      assert.equal(await updateProduct(B, mug.id, base({ name: "HACKED", variants: [v({ size: "x" })] })), false);
      assert.equal(await deleteProduct(B, mug.id), false);
      assert.equal((await getProduct(A, mug.id))!.name, "Mug");
      assert.equal(await prisma.productVariant.count({ where: { productId: mug.id } }), 2);
    });

    await check("a product can't be given another store's category; variant ids from another product are ignored", async () => {
      const foreign = await createCategory(B, { name: "Theirs", parentId: null });
      await productErr(createProduct(A, base({ name: "Nope", categoryId: foreign.id })), /category doesn't exist/);
      const mugVariant = (await getProduct(A, mug.id))!.variants[0];
      // Sending a variant id that belongs to a DIFFERENT product must not steal or modify it.
      const other = await createProduct(A, base({ name: "Other", variants: [v({ size: "S" }), v({ size: "M" })] }));
      await updateProduct(A, other.id, base({ name: "Other", variants: [{ ...v({ size: "S" }, 99), id: mugVariant.id }, v({ size: "M" })] }));
      assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: mugVariant.id } })).productId, mug.id);
      assert.notEqual((await prisma.productVariant.findUniqueOrThrow({ where: { id: mugVariant.id } })).stock, 99);
    });

    await check("deleting a product removes its variants", async () => {
      const id = (await createProduct(A, base({ name: "Temp", variants: [v({ size: "S" }), v({ size: "M" })] }))).id;
      assert.equal(await prisma.productVariant.count({ where: { productId: id } }), 2);
      assert.equal(await deleteProduct(A, id), true);
      assert.equal(await prisma.productVariant.count({ where: { productId: id } }), 0);
    });


    console.log("Orders:");
    const customer = {
      customerName: "Ada Lovelace",
      customerPhone: "+1 555 010 0199",
      customerAddress: "12 Analytical St",
      deliveryLocation: "https://maps.example/xyz",
      notes: "Ring twice",
    };
    const stockOf = async (variantId: string) =>
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
    const orderErr = (p: Promise<unknown>, code: string, pattern?: RegExp) =>
      assert.rejects(p, (e) => e instanceof OrderError && e.code === code && (!pattern || pattern.test(e.message)));

    // A fresh product with known stock and a price override to test snapshots.
    const tee = await createProduct(A, base({
      name: "Order Tee",
      basePriceCents: 2000,
      variants: [v({ size: "S" }, 5), v({ size: "M" }, 2, 2500), v({ size: "L" }, 1)],
    }));
    const [tS, tM, tL] = (await getProduct(A, tee.id))!.variants;
    const other = await createProduct(A, base({ name: "Order Hat", basePriceCents: 900, variants: [v({}, 10)] }));
    const hat = (await getProduct(A, other.id))!.variants[0];

    await check("placing an order deducts stock, prices on the server and snapshots name/attributes/price", async () => {
      const order = await placeOrder(A, customer, [
        { variantId: tS.id, quantity: 2 },
        { variantId: tM.id, quantity: 1 },
        { variantId: tS.id, quantity: 1 }, // duplicate line: merged into 3 x S
      ]);
      assert.equal(order.status, "PENDING");
      assert.equal(order.tenantId, A);
      assert.equal(order.items.length, 2);
      assert.equal(await stockOf(tS.id), 2);
      assert.equal(await stockOf(tM.id), 1);
      const s = order.items.find((i) => i.variantId === tS.id)!;
      const m = order.items.find((i) => i.variantId === tM.id)!;
      assert.equal(s.quantity, 3);
      assert.equal(s.priceCentsSnapshot, 2000); // base price
      assert.equal(m.priceCentsSnapshot, 2500); // variant override
      assert.equal(s.productNameSnapshot, "Order Tee");
      assert.deepEqual(s.variantAttributesSnapshot, { size: "S" });
      assert.equal(orderTotal(order.items), 3 * 2000 + 2500);
      // put the stock back for the following checks
      await prisma.productVariant.update({ where: { id: tS.id }, data: { stock: 5 } });
      await prisma.productVariant.update({ where: { id: tM.id }, data: { stock: 2 } });
    });

    await check("insufficient stock: clear error, no order, and no partial deduction on other lines", async () => {
      const before = (await listOrders(A)).length;
      await orderErr(
        placeOrder(A, customer, [{ variantId: tS.id, quantity: 2 }, { variantId: tL.id, quantity: 2 }]),
        "STOCK",
        /Only 1 left of "Order Tee \(size: L\)"/,
      );
      assert.equal((await listOrders(A)).length, before, "an order was created");
      assert.equal(await stockOf(tS.id), 5, "the first line's stock was deducted despite the failure");
      assert.equal(await stockOf(tL.id), 1);
      await prisma.productVariant.update({ where: { id: tL.id }, data: { stock: 0 } });
      await orderErr(placeOrder(A, customer, [{ variantId: tL.id, quantity: 1 }]), "STOCK", /just sold out/);
      await prisma.productVariant.update({ where: { id: tL.id }, data: { stock: 1 } });
    });

    await check("two customers racing for the last unit: exactly one succeeds, stock never goes negative", async () => {
      await prisma.productVariant.update({ where: { id: hat.id }, data: { stock: 1 } });
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => placeOrder(A, customer, [{ variantId: hat.id, quantity: 1 }])),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results) {
        if (r.status === "rejected") assert.ok(r.reason instanceof OrderError && r.reason.code === "STOCK");
      }
      assert.equal(await stockOf(hat.id), 0);
      assert.equal(await prisma.orderItem.count({ where: { variantId: hat.id } }), 1);
      await prisma.productVariant.update({ where: { id: hat.id }, data: { stock: 10 } });
    });

    await check("cart variant ids from another store (or unknown ids) are rejected; nothing changes", async () => {
      const foreign = (await createProduct(B, base({ name: "Foreign", variants: [v({}, 3)] }))).variants[0];
      const before = (await listOrders(B)).length;
      // B's storefront receives A's variant id
      await orderErr(placeOrder(B, customer, [{ variantId: tS.id, quantity: 1 }]), "UNAVAILABLE");
      // A's storefront receives B's variant id, mixed with a valid line
      await orderErr(placeOrder(A, customer, [{ variantId: foreign.id, quantity: 1 }, { variantId: tS.id, quantity: 1 }]), "UNAVAILABLE");
      await orderErr(placeOrder(A, customer, [{ variantId: "nope", quantity: 1 }]), "UNAVAILABLE");
      assert.equal((await listOrders(B)).length, before);
      assert.equal(await stockOf(tS.id), 5);
      assert.equal(await stockOf(foreign.id), 3);
    });

    await check("empty carts and bad quantities are rejected", async () => {
      await orderErr(placeOrder(A, customer, []), "EMPTY");
      for (const quantity of [0, -1, 1.5, 100, Number.NaN]) {
        await orderErr(placeOrder(A, customer, [{ variantId: tS.id, quantity }]), "INVALID");
      }
      await orderErr(placeOrder(A, customer, [{ variantId: tS.id, quantity: 60 }, { variantId: tS.id, quantity: 60 }]), "INVALID");
      assert.equal(await stockOf(tS.id), 5);
    });

    await check("checkout form validation: phone format, required fields and lengths", async () => {
      const good = { customerName: "Ada Lovelace", customerPhone: "+1 (555) 010-0199", customerAddress: "12 Analytical St", deliveryLocation: "near the park", notes: "" };
      assert.ok(checkoutSchema.safeParse(good).success);
      for (const bad of [
        { customerName: "A" }, { customerName: "" }, { customerPhone: "abc" }, { customerPhone: "12345" },
        { customerPhone: "1".repeat(20) }, { customerPhone: "555<script>" }, { customerAddress: "x" },
        { deliveryLocation: "" }, { notes: "x".repeat(501) },
      ]) {
        assert.ok(!checkoutSchema.safeParse({ ...good, ...bad }).success, `accepted ${JSON.stringify(bad)}`);
      }
      assert.ok(cartLinesSchema.safeParse([{ variantId: "a", quantity: 1 }]).success);
      assert.ok(!cartLinesSchema.safeParse([]).success);
      assert.ok(!cartLinesSchema.safeParse([{ variantId: "a", quantity: 0 }]).success);
    });

    await check("order history is a snapshot: renaming, repricing and deleting the product don't change it", async () => {
      const order = await placeOrder(A, customer, [{ variantId: tM.id, quantity: 1 }]);
      await updateProduct(A, tee.id, base({
        name: "Renamed Tee",
        basePriceCents: 99999,
        variants: [
          { ...v({ size: "S" }, 5), id: tS.id },
          { ...v({ size: "M" }, 1, 77777), id: tM.id },
          { ...v({ size: "L" }, 1), id: tL.id },
        ],
      }));
      const item = (await getOrder(A, order.id))!.items[0];
      assert.equal(item.productNameSnapshot, "Order Tee");
      assert.equal(item.priceCentsSnapshot, 2500);
      assert.deepEqual(item.variantAttributesSnapshot, { size: "M" });
      // Remove the medium variant entirely: the order keeps its snapshot, variantId is cleared.
      await updateProduct(A, tee.id, base({ name: "Renamed Tee", variants: [{ ...v({ size: "S" }, 5), id: tS.id }, { ...v({ size: "L" }, 1), id: tL.id }] }));
      const after = (await getOrder(A, order.id))!.items[0];
      assert.equal(after.variantId, null);
      assert.equal(after.productNameSnapshot, "Order Tee");
      assert.equal(after.quantity, 1);
      // Cancelling an order whose variant is gone must not fail (there's nothing to restore).
      await updateOrderStatus(A, order.id, "CANCELLED");
      assert.equal((await getOrder(A, order.id))!.status, "CANCELLED");
    });

    await check("status flow Pending > Confirmed > Delivered; no skipping; Cancelled is final", async () => {
      const o = await placeOrder(A, customer, [{ variantId: tS.id, quantity: 1 }]);
      await orderErr(updateOrderStatus(A, o.id, "DELIVERED"), "BAD_TRANSITION");
      await orderErr(updateOrderStatus(A, o.id, "PENDING"), "BAD_TRANSITION");
      await updateOrderStatus(A, o.id, "CONFIRMED");
      await orderErr(updateOrderStatus(A, o.id, "PENDING"), "BAD_TRANSITION");
      await updateOrderStatus(A, o.id, "DELIVERED");
      assert.equal(await stockOf(tS.id), 4, "stock stays deducted for delivered orders");
      await updateOrderStatus(A, o.id, "CANCELLED"); // cancelling is allowed at any point
      assert.equal(await stockOf(tS.id), 5);
      await orderErr(updateOrderStatus(A, o.id, "CONFIRMED"), "BAD_TRANSITION");
      await orderErr(updateOrderStatus(A, o.id, "CANCELLED"), "BAD_TRANSITION");
    });

    await check("cancelling restores stock exactly once, even when cancelled twice at the same time", async () => {
      const o = await placeOrder(A, customer, [{ variantId: tS.id, quantity: 2 }, { variantId: tL.id, quantity: 1 }]);
      assert.equal(await stockOf(tS.id), 3);
      assert.equal(await stockOf(tL.id), 0);
      const results = await Promise.allSettled([
        updateOrderStatus(A, o.id, "CANCELLED"),
        updateOrderStatus(A, o.id, "CANCELLED"),
        updateOrderStatus(A, o.id, "CANCELLED"),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await stockOf(tS.id), 5, "stock restored more than once (or not at all)");
      assert.equal(await stockOf(tL.id), 1);
    });

    await check("store B cannot see, list or change store A's orders (and A's stock is untouched)", async () => {
      const o = await placeOrder(A, customer, [{ variantId: tS.id, quantity: 1 }]);
      assert.equal(await getOrder(B, o.id), null);
      assert.ok(!(await listOrders(B)).some((x) => x.id === o.id));
      await orderErr(updateOrderStatus(B, o.id, "CANCELLED"), "NOT_FOUND");
      await orderErr(updateOrderStatus(B, o.id, "CONFIRMED"), "NOT_FOUND");
      assert.equal((await getOrder(A, o.id))!.status, "PENDING");
      assert.equal(await stockOf(tS.id), 4);
      assert.ok((await listOrders(A)).some((x) => x.id === o.id));
    });

    await check("orders are newest first", async () => {
      const list = await listOrders(A);
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i - 1].createdAt >= list[i].createdAt, "orders not sorted newest first");
      }
    });

    await check("deleting a whole store cascades over a nested category tree with assigned products", async () => {
      const c = await mk("C");
      try {
        const m = await createCategory(c.tenant.id, { name: "Men", parentId: null });
        const s = await createCategory(c.tenant.id, { name: "Shoes", parentId: m.id });
        const nk = await createCategory(c.tenant.id, { name: "Nike", parentId: s.id });
        await prisma.product.create({
          data: { tenantId: c.tenant.id, name: "Air", slug: "air", basePriceCents: 100, categoryId: nk.id },
        });
        const pv = (await createProduct(c.tenant.id, base({ name: "Cascade Item", categoryId: nk.id, variants: [v({}, 2)] }))).variants[0];
        await placeOrder(c.tenant.id, customer, [{ variantId: pv.id, quantity: 1 }]);
        // No manual cleanup first: this is exactly what every test script's teardown does.
        await prisma.tenant.deleteMany({ where: { id: c.tenant.id } });
        assert.equal(await prisma.category.count({ where: { tenantId: c.tenant.id } }), 0);
        assert.equal(await prisma.product.count({ where: { tenantId: c.tenant.id } }), 0);
        assert.equal(await prisma.order.count({ where: { tenantId: c.tenant.id } }), 0);
      } finally {
        await prisma.tenant.deleteMany({ where: { id: c.tenant.id } });
        await prisma.user.deleteMany({ where: { id: c.user.id } });
      }
    });
  } finally {
    await prisma.tenant.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
  }
  console.log(`\nAll ${passed} commerce checks passed.`);
}

main()
  .catch((e) => {
    console.error("\nCOMMERCE CHECK FAILED\n", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
