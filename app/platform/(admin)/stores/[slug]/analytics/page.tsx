import Link from "next/link";
import { CopyText } from "@/components/copy-text";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { storeIntegrations } from "@/lib/integrations";
import { getStoreUrl } from "@/lib/store-url";
import { loadStore } from "../load";
import { AnalyticsForm } from "./analytics-form";

const ext = "underline underline-offset-4";

const EVENTS = [
  { when: "Any page is opened", ga: "page_view (automatic)", meta: "PageView", ads: "—" },
  { when: "A product page is viewed", ga: "view_item", meta: "ViewContent", ads: "—" },
  { when: "Add to cart", ga: "add_to_cart", meta: "AddToCart", ads: "—" },
  { when: "Checkout page opened", ga: "begin_checkout", meta: "InitiateCheckout", ads: "—" },
  {
    when: "Order placed",
    ga: "purchase (value, items, order id)",
    meta: "Purchase (value, order id)",
    ads: "conversion (value, order id)",
  },
];

export default async function StoreAnalyticsPage({
  params,
}: PageProps<"/platform/stores/[slug]/analytics">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const { analytics, metaDomainVerification } = storeIntegrations(tenant);
  const storeUrl = getStoreUrl(tenant);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Tracking IDs for this store</CardTitle>
          <CardDescription>
            Each store gets its own. They&apos;re added to this store&apos;s pages only — not to
            other stores, the admin dashboards or the editor previews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsForm
            slug={tenant.slug}
            hasDomain={!!tenant.domain}
            initial={{
              gaMeasurementId: analytics.gaId,
              googleAdsId: analytics.adsId,
              googleAdsPurchaseLabel: analytics.adsPurchaseLabel,
              metaPixelId: analytics.metaPixelId,
              metaDomainVerification,
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-amber-500/50">
        <CardHeader>
          <CardTitle>Cookie consent</CardTitle>
          <CardDescription>
            These tags set tracking cookies. If this store sells to visitors in the EU/EEA or UK,
            the law there requires asking for consent first, and Google requires Consent Mode for
            ad personalisation there. The storefront doesn&apos;t have a consent banner yet — until
            it does, only turn these on for stores that don&apos;t target those regions.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What gets tracked</CardTitle>
          <CardDescription>Sent automatically once the IDs above are saved. Amounts in USD.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Shopper</th>
                  <th className="px-3 py-2 font-medium">Google Analytics 4</th>
                  <th className="px-3 py-2 font-medium">Meta Pixel</th>
                  <th className="px-3 py-2 font-medium">Google Ads</th>
                </tr>
              </thead>
              <tbody>
                {EVENTS.map((e) => (
                  <tr key={e.when} className="border-t">
                    <td className="px-3 py-2">{e.when}</td>
                    <td className="px-3 py-2 font-mono">{e.ga}</td>
                    <td className="px-3 py-2 font-mono">{e.meta}</td>
                    <td className="px-3 py-2 font-mono">{e.ads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A purchase is sent once, when the shopper lands on the confirmation page right after
            ordering — reopening that link later doesn&apos;t count it again.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Analytics 4</CardTitle>
          <CardDescription>Traffic, where shoppers come from, and sales.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <ol className="grid list-decimal gap-3 pl-5">
            <li>
              In{" "}
              <Link href="https://analytics.google.com/" target="_blank" className={ext}>
                Google Analytics
              </Link>
              : <em>Admin → Create → Property</em>. One property per store; set its currency to
              USD and the store&apos;s time zone.
            </li>
            <li>
              <em>Data streams → Add stream → Web</em>, website URL <CopyText value={storeUrl} />.
              Leave <em>Enhanced measurement</em> on, including &ldquo;Page changes based on
              browser history events&rdquo; — that&apos;s how page views after the first one are
              counted.
            </li>
            <li>
              Copy the stream&apos;s <strong>Measurement ID</strong> (<code>G-…</code>) into the
              form above and save.
            </li>
            <li>
              Check: open the store in another tab and watch <em>Reports → Realtime</em>. Sales
              appear under <em>Reports → Monetization</em> (<code>purchase</code> is a key event
              by default — confirm under <em>Admin → Events</em>).
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card id="google-ads">
        <CardHeader>
          <CardTitle>Google Ads</CardTitle>
          <CardDescription>Count orders as conversions so campaigns can optimise for sales.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="grid gap-2">
            <strong>Option A — import from GA4 (simplest if GA4 is set up)</strong>
            <ol className="grid list-decimal gap-2 pl-5">
              <li>
                GA4: <em>Admin → Product links → Google Ads links</em> → link the store&apos;s Ads
                account.
              </li>
              <li>
                Google Ads: <em>Goals → Conversions → New conversion action → Import → Google
                Analytics 4 → Web</em> → select <code>purchase</code>.
              </li>
              <li>Leave the two Google Ads fields above empty.</li>
            </ol>
          </div>
          <div className="grid gap-2">
            <strong>Option B — the Google Ads tag directly</strong>
            <ol className="grid list-decimal gap-2 pl-5">
              <li>
                Google Ads: <em>Goals → Conversions → New conversion action → Website</em>, enter
                the store&apos;s URL, then <em>Add a conversion action manually</em>: category{" "}
                <em>Purchase</em>, value &ldquo;Use different values for each conversion&rdquo;,
                count &ldquo;Every&rdquo;.
              </li>
              <li>
                Choose <em>Use Google tag → Install the tag yourself</em>. The event snippet
                contains <code>&apos;send_to&apos;: &apos;AW-123456789/AbC-dEfGhIjK&apos;</code> —
                the part before the slash is the <strong>tag ID</strong>, after it the{" "}
                <strong>conversion label</strong>. Paste both above.
              </li>
            </ol>
          </div>
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Use <strong>one</strong> option as the <em>Primary</em> purchase conversion. If both
            are primary, every order is counted twice and bidding goes wrong. The tag ID on its
            own (no label) still builds remarketing audiences.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Meta (Facebook &amp; Instagram ads)</CardTitle>
          <CardDescription>Track ad results and build audiences from store visitors.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ol className="grid list-decimal gap-3 pl-5">
            <li>
              In{" "}
              <Link href="https://business.facebook.com/events_manager2" target="_blank" className={ext}>
                Meta Events Manager
              </Link>
              : <em>Connect data sources → Web</em>, name it after the store, and copy the{" "}
              <strong>dataset (Pixel) ID</strong> into the form above. Skip Meta&apos;s &ldquo;install
              code&rdquo; steps — the store already has the code.
            </li>
            <li>
              {tenant.domain ? (
                <>
                  <em>Business settings → Brand safety → Domains → Add</em>{" "}
                  <CopyText value={tenant.domain.replace(/^www\./, "")} />, choose the{" "}
                  <em>meta-tag</em> method, paste the tag into the form above, save, then click{" "}
                  <em>Verify</em>. (The DNS TXT method works too, and needs nothing here.)
                </>
              ) : (
                <>
                  Domain verification needs the store&apos;s own domain — connect one first. Ads
                  still run without it, but Meta may limit which events it uses for optimisation.
                </>
              )}
            </li>
            <li>
              Check: Events Manager → the dataset → <em>Test events</em>, enter the store&apos;s URL
              and click around — PageView, ViewContent, AddToCart, InitiateCheckout and Purchase
              should appear. The Meta Pixel Helper browser extension shows the same thing.
            </li>
            <li>
              In Ads Manager, use a <em>Sales</em> campaign optimised for <strong>Purchase</strong>.
            </li>
          </ol>
          <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Events are sent from the shopper&apos;s browser only. Ad blockers and iOS privacy
            settings hide some of them, so Meta will report fewer sales than the Orders page. Meta&apos;s
            server-side Conversions API isn&apos;t connected yet.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
