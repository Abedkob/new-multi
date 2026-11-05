import Link from "next/link";
import { recordPlatformConsoleView } from "@/lib/analytics/audit";
import { rangeFromPeriod, REPORT_PERIODS } from "@/lib/analytics/range";
import { platformConsole, type StoreLine } from "@/lib/data/platform-analytics";
import { formatPrice } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/session";

/**
 * The platform console (§5.8, D43): aggregates across stores, and nothing about a person.
 *
 * Three properties this page is built to hold:
 *
 *   1. **No person-level data is reachable** (P5-21). It reads `lib/data/platform-analytics.ts`,
 *      which reads aggregate tables only, and there is no store-level drill-down from here into
 *      anything finer. The link beside each store goes to that store's settings — the page a
 *      platform admin already had — not to its visitors.
 *   2. **Every view is logged** (P5-23). The row is written here, where the numbers are read,
 *      so there is no way to reach the figures without leaving a record naming the admin.
 *   3. **A small store keeps its real numbers and is told there is no trend** (P5-22). The
 *      verdict comes from `compare.ts`, the same module the store owner's own overview uses, so
 *      a merchant and a platform admin can never be told different things about one week.
 *
 * English only, deliberately: this is an internal operations screen for the platform's own
 * staff, not a merchant-facing one. §5.9's Arabic requirement is about the store owner's
 * dashboard and the storefront.
 */
export default async function PlatformConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const admin = await requirePlatformAdmin();
  const { period } = await searchParams;
  // UTC for the platform's own console. A cross-store figure cannot be in every store's local
  // time at once — each store's own aggregate rows are already in its own zone, and this page
  // only chooses which days to add up. The zone is printed beside the dates rather than left to
  // be guessed at.
  const timeZone = "UTC";
  const { range, period: current } = rangeFromPeriod(period, timeZone);

  const report = await platformConsole(range);
  await recordPlatformConsoleView({
    actorUserId: admin.userId,
    actorEmail: admin.email,
    from: range.from,
    to: range.to,
    timeZone,
  });

  const { totals, health } = report;

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">Analytics across all stores</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Aggregate figures only. Visitor histories and raw events are not reachable from here,
          for anyone. Every visit to this page is recorded in the analytics audit log with your
          email address and the period you were looking at.
        </p>
        <nav aria-label="Period" className="flex flex-wrap gap-1 pt-1">
          {REPORT_PERIODS.map((option) => (
            <Link
              key={option.id}
              href={`/platform/analytics?period=${option.id}`}
              aria-current={option.id === current ? "true" : undefined}
              className={
                option.id === current
                  ? "rounded-md border border-foreground px-3 py-1.5 text-sm font-medium"
                  : "rounded-md border px-3 py-1.5 text-sm text-muted-foreground"
              }
            >
              Last {option.days} days
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground">
          {range.from} to {range.to}, in {timeZone}. Compared with {report.comparedWith.from} to{" "}
          {report.comparedWith.to}.
        </p>
      </header>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Totals</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Stores measured" value={String(totals.storesMeasured)} />
          <Figure label="Stores with activity" value={String(totals.storesWithActivity)} />
          <Figure label="Visits" value={String(totals.sessions)} />
          <Figure
            label="Visitor-days"
            value={String(totals.visitorDays)}
            note="Daily visitor counts added up — not distinct people."
          />
          <Figure label="Website orders" value={String(totals.orders)} />
          <Figure label="Order value" value={formatPrice(totals.orderValueCents)} />
          <Figure label="WhatsApp messages" value={String(totals.whatsappClickSessions)} />
          {/* Its own figure, under its own label, never added to order value (§3.4). */}
          <Figure
            label="Basket at the message"
            value={formatPrice(totals.whatsappPotentialValueCents)}
            note="Interest, not revenue."
          />
        </dl>
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Per store</h2>
        {report.stores.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            No store has measured activity in this period.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 text-start font-medium">
                  Store
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  Visits
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  Orders
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  Order value
                </th>
                <th scope="col" className="py-1 text-end font-medium">
                  WhatsApp
                </th>
                <th scope="col" className="py-1 text-start font-medium">
                  Visits trend
                </th>
              </tr>
            </thead>
            <tbody>
              {report.stores.map((store) => (
                <tr key={store.tenantId} className="border-t" data-store={store.slug}>
                  <th scope="row" className="py-1.5 text-start font-normal">
                    <Link href={`/platform/stores/${store.slug}`} className="underline underline-offset-4">
                      {store.name}
                    </Link>
                  </th>
                  <td className="py-1.5 text-end tabular-nums">{store.sessions}</td>
                  <td className="py-1.5 text-end tabular-nums">{store.orders}</td>
                  <td className="py-1.5 text-end tabular-nums">
                    {formatPrice(store.orderValueCents)}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{store.whatsappClickSessions}</td>
                  <td className="py-1.5 text-start">
                    <Verdict store={store} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <StoreList title="Growing" stores={report.growing} empty="No store grew by §5.8's rule." />
        <StoreList
          title="Declining"
          stores={report.declining}
          empty="No store declined by §5.8's rule."
        />
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">No activity in the last 7 days</h2>
          {report.inactive.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every store saw something this week.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {report.inactive.map((store) => (
                <li key={store.tenantId} data-inactive={store.slug}>
                  <Link href={`/platform/stores/${store.slug}`} className="underline underline-offset-4">
                    {store.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            No visit, order or WhatsApp message in seven days — including stores that are not in
            the measurement rollout yet, which have no rows at all rather than zeros.
          </p>
        </section>
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Ingestion and aggregation</h2>
        {health.lastWindowEnd === null ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No ingestion counters have been flushed yet. An instance with no traffic writes no
            row, so this is silence rather than failure — but it is also not proof of health.
          </p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure
              label="Counters flushed up to"
              value={health.lastWindowEnd.toISOString().replace("T", " ").slice(0, 16)}
            />
            <Figure
              label="Batches accepted"
              value={`${health.acceptedBatches} of ${health.attemptedBatches}`}
            />
            <Figure label="Events stored" value={String(health.storedEvents)} />
            <Figure
              label="Rejected by the contract"
              value={String(health.contractRejections)}
              note="A client sending what the endpoint refuses — usually a bug, not abuse."
            />
            <Figure label="Policy drops" value={String(health.policyDrops)} />
            <Figure label="Operational drops" value={String(health.operationalDrops)} />
            <Figure
              label="Slowest store last aggregated"
              value={
                health.oldestLastRunAt
                  ? health.oldestLastRunAt.toISOString().replace("T", " ").slice(0, 16)
                  : "never"
              }
            />
            <Figure label="Stores with failures" value={String(health.failingStores.length)} />
          </dl>
        )}
        {health.failingStores.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {health.failingStores.map((failure) => (
              <li key={`${failure.slug}-${failure.stage}`} data-failing={failure.slug}>
                <strong>{failure.slug}</strong> — {failure.stage}: {failure.failures} consecutive
                failure(s){failure.lastError ? `, last error: ${failure.lastError}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid gap-1 rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * The trend, or the sentence that replaces it (P5-22).
 *
 * "Not enough activity for a reliable trend" is not a softer way of saying steady: it means the
 * comparison is too small to carry a verdict at all, and the real numbers are in the row beside
 * it either way.
 */
function Verdict({ store }: { store: StoreLine }) {
  const reading = store.trends.sessions;
  if (reading.verdict === "insufficient") {
    return (
      <span className="text-xs text-muted-foreground" data-verdict="insufficient">
        Not enough activity for a reliable trend
      </span>
    );
  }
  return (
    <span className="text-xs" data-verdict={reading.verdict}>
      <strong className="capitalize">{reading.verdict}</strong> — {reading.evidence}
    </span>
  );
}

function StoreList({
  title,
  stores,
  empty,
}: {
  title: string;
  stores: StoreLine[];
  empty: string;
}) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {stores.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {stores.map((store) => (
            <li key={store.tenantId} data-trending={store.slug}>
              <Link href={`/platform/stores/${store.slug}`} className="underline underline-offset-4">
                {store.name}
              </Link>{" "}
              <span className="text-xs text-muted-foreground">{store.trends.sessions.evidence}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
