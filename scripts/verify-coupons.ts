import "dotenv/config";
import "./_owner";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { createStoreWithOwner, updateTenantDeliverySettings } from "../lib/data/tenants";
import { createProduct } from "../lib/data/products";
import { createDiscount, setDiscountAssignmentsForProducts } from "../lib/data/discounts";
import { archiveCoupon, createCoupon, getCoupon, updateCoupon } from "../lib/data/coupons";
import { OrderError, placeOrder, previewCoupon } from "../lib/data/orders";
import { orderTotal } from "../lib/orders";

async function main() {
  const run = Date.now().toString(36);
  const store = await createStoreWithOwner({ storeName: `Coupon Verify ${run}`, ownerName: "Coupon", ownerEmail: `coupon-${run}@example.test`, passwordHash: "x" });
  const tenantId = store.tenant.id;
  try {
    await updateTenantDeliverySettings(tenantId, { deliveryFeeCents: 500, deliveryNote: "Test delivery" });
    const product = await createProduct(tenantId, { name: "Eligible", description: "", basePriceCents: 1000, imageUrl: "", images: [], isBestSeller: false, categoryId: null, variants: [{ attributes: {}, stock: 20, priceCentsOverride: null, imageUrl: null }] });
    const automatic = await createDiscount(tenantId, { name: "Automatic 20", type: "PERCENTAGE", value: 20, isEnabled: true, startsAt: null, endsAt: null });
    await setDiscountAssignmentsForProducts(tenantId, automatic.id, [product.id], [product.id]);
    const coupon = await createCoupon(tenantId, { name: "Checkout 10", code: "SAVE10", scope: "ORDER_SUBTOTAL", type: "PERCENTAGE", value: 10, isEnabled: true, startsAt: null, endsAt: null, isAnnounced: true, announcementText: "Save with {code}", productIds: [] });
    const variantId = product.variants[0].id;
    const preview = await previewCoupon(tenantId, "save10", [{ variantId, quantity: 2 }]);
    assert.equal(preview.merchandiseDiscountCents, 160, "coupon must run after the automatic 20% discount");
    assert.equal(preview.totalCents, 1940);
    const customer = { customerName: "Ada Lovelace", customerPhone: "+1 555 010 0199", customerAddress: "12 Test Street", deliveryLocation: "Test location", notes: "" };
    await assert.rejects(placeOrder(tenantId, customer, [{ variantId, quantity: 2 }], { couponCode: "SAVE10", expectedTotalCents: 1 }), (error) => error instanceof OrderError && error.code === "COUPON_CHANGED");
    const order = await placeOrder(tenantId, customer, [{ variantId, quantity: 2 }], { couponCode: "save10", expectedTotalCents: 1940 });
    assert.equal(order.couponDiscountCentsSnapshot, 160);
    assert.equal(order.items.reduce((sum, item) => sum + item.couponDiscountCentsSnapshot, 0), 160);
    assert.equal(orderTotal(order.items, order.deliveryFeeCentsSnapshot, order.couponDiscountCentsSnapshot), 1940);
    await assert.rejects(updateCoupon(tenantId, coupon.id, { name: "Renamed", code: "NEWCODE", scope: "ORDER_SUBTOTAL", type: "PERCENTAGE", value: 10, isEnabled: true, startsAt: null, endsAt: null, isAnnounced: true, announcementText: "{code}", productIds: [], revision: coupon.revision }));
    const shipping = await createCoupon(tenantId, { name: "Ship", code: "SHIPFREE", scope: "FREE_DELIVERY", type: null, value: null, isEnabled: true, startsAt: null, endsAt: null, isAnnounced: true, announcementText: "Free delivery {code}", productIds: [] });
    const announced = await prisma.coupon.findMany({ where: { tenantId, isAnnounced: true } });
    assert.deepEqual(announced.map((item) => item.id), [shipping.id], "only one coupon may be announced");
    const shippingPreview = await previewCoupon(tenantId, "SHIPFREE", [{ variantId, quantity: 1 }]);
    assert.equal(shippingPreview.deliveryDiscountCents, 500);
    await archiveCoupon(tenantId, shipping.id);
    await assert.rejects(previewCoupon(tenantId, "SHIPFREE", [{ variantId, quantity: 1 }]), (error) => error instanceof OrderError && error.code === "COUPON_INVALID");
    assert.equal((await getCoupon(tenantId, coupon.id))?.code, "SAVE10", "historical code changed");
    console.log("Coupon checkout, snapshots, announcement uniqueness, archive, and automatic-discount stacking passed.");
  } finally {
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { id: store.user.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
