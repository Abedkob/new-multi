/**
 * "Running low": the alert when a variant reaches the threshold its product carries (D96).
 *
 * Three decisions shape this file, and each of them is a departure from the analytics alerts next
 * door in owner-alerts.ts:
 *
 *  1. **It reaches every store.** `ownerTenants()` filters by `participationWhere()`, the analytics
 *     rollout, whose default is `off` — so an alert built on it would be invisible to almost every
 *     merchant. Running out of something is like a new order: true whether or not the shop is being
 *     measured. So this walks the stock itself, the way `newOrderCatchUp` walks orders.
 *  2. **It fires on the transition, not on the condition** (D55's mechanism, D96's rule). The
 *     condition "2 left" stays true for as long as nobody restocks, so a sweep that sent on the
 *     condition would send every five minutes. `NotificationAlertState` holds whether each variant
 *     is currently firing, and a variant re-arms only when its stock rises back ABOVE its
 *     threshold. There is deliberately no cooldown: a discontinued product that will never be
 *     restocked must go quiet and stay quiet, which a cooldown would not do.
 *  3. **One notification per store per sweep.** Forty variants crossing during a busy afternoon is
 *     one notification naming a count, not forty buzzes — `newOrderCatchUp`'s rule.
 *
 * It is not an analytics alert: `LOW_STOCK` is kept out of `ANALYTICS_ALERT_TYPES`, so it carries
 * no evidence sentence and asserts no cause. The threshold is the owner's own number, and the
 * stock is counted rather than inferred, which is the whole of what the body says.
 */

import { claimNotification } from "@/lib/data/notifications";
import { wantsNotification } from "@/lib/data/notification-preferences";
import { sendableDevices } from "@/lib/data/push-subscriptions";
import { deliverNotification } from "@/lib/notifications/deliver";
import { lowStockText, type NotificationLocale } from "@/lib/notifications/templates";
import { withJobBypass } from "@/lib/prisma-job";
import { withBypass } from "@/lib/prisma";
import { buildAlertPayload } from "@/lib/push/payload";
import { LOW_STOCK } from "@/lib/variants";

/** How many stores one sweep will look at, matching every other stage's bound. */
const STORE_BATCH = 50;

/**
 * How many low variants one store's notification will consider.
 *
 * A shop whose whole catalogue is below its thresholds does not need every line counted — it needs
 * to be told, once, that a lot is low. The cap keeps the per-store query bounded regardless.
 */
const LINES_PER_STORE = 50;

type LowRow = {
  tenantId: string;
  variantId: string;
  productId: string;
  productName: string;
  stock: number;
  threshold: number;
};

export type LowStockOutcome = { stores: number; sent: number; crossings: number; cleared: number };

/**
 * Every variant that is at or below its product's threshold, across every store, newest-crossing
 * first is irrelevant — it is ordered by store so the grouping below is a single pass.
 *
 * Raw because `stock <= COALESCE(p."lowStockThreshold", 3)` compares two columns, which Prisma's
 * query builder cannot express, and because one statement across all stores beats one per store
 * when most stores have nothing low.
 */
function findLowVariants(): Promise<LowRow[]> {
  return withJobBypass(
    (db) => db.$queryRaw<LowRow[]>`
      SELECT p."tenantId", v."id" AS "variantId", p."id" AS "productId",
             p."name" AS "productName", v."stock",
             COALESCE(p."lowStockThreshold", ${LOW_STOCK}) AS "threshold"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      WHERE v."stock" <= COALESCE(p."lowStockThreshold", ${LOW_STOCK})
      ORDER BY p."tenantId", v."stock" ASC
    `,
  );
}

/**
 * Mark these variants as firing and report which ones were not already.
 *
 * The write happens either way, so the next sweep knows. `entityKey` is the variant id — a cuid,
 * and therefore globally unique, which matters because `NotificationAlertState`'s unique key is
 * (audience, type, entityKey) and carries no tenant of its own.
 */
async function markFiring(rows: readonly LowRow[], now: Date): Promise<Set<string>> {
  const crossed = new Set<string>();
  await withBypass(async (db) => {
    for (const row of rows) {
      const key = {
        audience: "OWNER" as const,
        type: "LOW_STOCK" as const,
        entityKey: row.variantId,
      };
      const existing = await db.notificationAlertState.findUnique({
        where: { audience_type_entityKey: key },
        select: { state: true },
      });
      if (existing?.state !== "firing") crossed.add(row.variantId);
      await db.notificationAlertState.upsert({
        where: { audience_type_entityKey: key },
        create: {
          ...key,
          tenantId: row.tenantId,
          state: "firing",
          enteredAt: now,
          lastSentAt: now,
          detail: `${row.stock} left, threshold ${row.threshold}`,
        },
        update: {
          state: "firing",
          enteredAt: existing?.state === "firing" ? undefined : now,
          lastSentAt: now,
          detail: `${row.stock} left, threshold ${row.threshold}`,
        },
      });
    }
  });
  return crossed;
}

/**
 * Re-arm everything that is no longer low.
 *
 * Without this a variant that was restocked would keep its "firing" row forever, and the next time
 * it ran down nothing would look like a transition — the alert would fire once in the life of the
 * product and never again.
 */
async function clearRestocked(stillLow: ReadonlySet<string>): Promise<number> {
  return withBypass(async (db) => {
    const firing = await db.notificationAlertState.findMany({
      where: { audience: "OWNER", type: "LOW_STOCK", state: "firing" },
      select: { id: true, entityKey: true },
    });
    const restocked = firing.filter((row) => !stillLow.has(row.entityKey));
    if (restocked.length === 0) return 0;
    await db.notificationAlertState.updateMany({
      where: { id: { in: restocked.map((row) => row.id) } },
      data: { state: "clear", enteredAt: null },
    });
    return restocked.length;
  });
}

/** The stores in this sweep, with the owner and locale fields the notification needs. */
function ownersOf(tenantIds: readonly string[]) {
  return withJobBypass((db) =>
    db.tenant.findMany({
      where: { id: { in: [...tenantIds] } },
      select: {
        id: true,
        defaultLocale: true,
        owner: { select: { id: true, adminLocale: true } },
      },
    }),
  );
}

function localeOf(tenant: {
  defaultLocale: string;
  owner: { adminLocale: string | null } | null;
}): NotificationLocale {
  const chosen = tenant.owner?.adminLocale;
  if (chosen === "ar" || chosen === "en") return chosen;
  return tenant.defaultLocale === "ar" ? "ar" : "en";
}

/**
 * One sweep: find what is low, work out what newly crossed, tell each affected owner once.
 *
 * Returns counts rather than logging, so the stage can report them and a test can assert them.
 */
export async function evaluateLowStock(
  now: Date,
  opts: { dryRun?: boolean } = {},
): Promise<LowStockOutcome> {
  const rows = await findLowVariants();
  const stillLow = new Set(rows.map((row) => row.variantId));
  const cleared = opts.dryRun ? 0 : await clearRestocked(stillLow);

  const byTenant = new Map<string, LowRow[]>();
  for (const row of rows) {
    const lines = byTenant.get(row.tenantId);
    if (lines) {
      if (lines.length < LINES_PER_STORE) lines.push(row);
    } else if (byTenant.size < STORE_BATCH) {
      byTenant.set(row.tenantId, [row]);
    }
  }
  if (byTenant.size === 0) return { stores: 0, sent: 0, crossings: 0, cleared };

  if (opts.dryRun) {
    // Deliberately does not write the state rows: a dry run that marked everything firing would
    // silence the next real sweep, which is the opposite of harmless.
    return { stores: byTenant.size, sent: 0, crossings: 0, cleared };
  }

  const crossed = await markFiring([...byTenant.values()].flat(), now);
  const tenants = await ownersOf([...byTenant.keys()]);
  let sent = 0;
  let crossings = 0;

  for (const tenant of tenants) {
    const lines = byTenant.get(tenant.id) ?? [];
    const newly = lines.filter((row) => crossed.has(row.variantId));
    if (newly.length === 0) continue;
    crossings += newly.length;
    if (!tenant.owner) continue;
    if (!(await wantsNotification(tenant.owner.id, "STORE_OWNER", "LOW_STOCK"))) continue;

    const lead = newly[0];
    const locale = localeOf(tenant);
    const text = lowStockText(locale, {
      product: lead.productName,
      left: lead.stock,
      threshold: lead.threshold,
      others: newly.length - 1,
    });
    // The screen that shows the evidence and is also where it gets fixed.
    const destination = `/admin/products/${lead.productId}/stock`;

    const claim = await claimNotification({
      recipientUserId: tenant.owner.id,
      recipientRole: "STORE_OWNER",
      audience: "OWNER",
      type: "LOW_STOCK",
      tenantId: tenant.id,
      title: text.title,
      body: text.body,
      destination,
      locale,
      // Keyed on the CROSSING, not on a day.
      //
      // The other owner senders bucket their dedupe key by local day because they have no
      // transition state and rely on a cooldown. Here the state row is the deduplication: a
      // variant that is already firing never reaches this line at all. A day bucket would
      // therefore add nothing and take something away — restock a shelf at noon, sell it out by
      // four, and the second crossing is a real event the owner wants, which a day key swallows.
      // `now` is one instant per sweep, and a crossing can only be detected by one sweep.
      dedupeKey: `LOW_STOCK:${tenant.owner.id}:${lead.variantId}:${now.toISOString()}`,
    });
    if (!claim) continue;

    await deliverNotification(
      claim.id,
      tenant.id,
      await sendableDevices(tenant.owner.id, "OWNER"),
      buildAlertPayload({
        type: "LOW_STOCK",
        text,
        recipientUserId: tenant.owner.id,
        entityKey: lead.variantId,
        locale,
        destination,
      }),
    );
    sent += 1;
  }

  return { stores: byTenant.size, sent, crossings, cleared };
}
