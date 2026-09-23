import Link from "next/link";
import { CopyText } from "@/components/copy-text";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { env } from "@/lib/env";
import { storeIntegrations } from "@/lib/integrations";
import { getStoreUrl } from "@/lib/store-url";
import { loadStore } from "../load";
import { VerificationForm } from "./verification-form";

const SEARCH_CONSOLE = "https://search.google.com/search-console";

export default async function StoreSearchPage({
  params,
}: PageProps<"/platform/stores/[slug]/search">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const { googleSiteVerification } = storeIntegrations(tenant);

  const home = getStoreUrl(tenant);
  const sitemap = getStoreUrl(tenant, "/sitemap.xml");
  const robots = getStoreUrl(tenant, "/robots.txt");
  const platformSitemap = `${env.baseUrl}/sitemap.xml`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>What to submit to Google</CardTitle>
          <CardDescription>
            {tenant.domain
              ? "This store has its own domain, so it gets its own Search Console property and its own sitemap."
              : "This store has no domain yet, so it lives under the platform's address."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Sitemap to submit</span>
            <CopyText value={tenant.domain ? sitemap : platformSitemap} />
          </div>
          {!tenant.domain && (
            <p className="text-muted-foreground">
              That&apos;s the platform-wide sitemap index: it lists every store without its own
              domain, including this one (<Link href={sitemap} target="_blank" className="underline underline-offset-4">its own sitemap</Link>).
              Submit it <strong>once</strong>, in a Search Console property for{" "}
              <code>{new URL(env.baseUrl).hostname}</code> — not once per store. Once this store
              gets a domain it drops out of that index automatically and needs the steps below.
            </p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href={sitemap} target="_blank" className="underline underline-offset-4">
              View this store&apos;s sitemap ↗
            </Link>
            <Link href={robots} target="_blank" className="underline underline-offset-4">
              View robots.txt ↗
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step by step</CardTitle>
          <CardDescription>
            In{" "}
            <Link href={SEARCH_CONSOLE} target="_blank" className="underline underline-offset-4">
              Google Search Console
            </Link>
            , signed in with the Google account that should own this store&apos;s search data.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {tenant.domain ? (
            <ol className="grid list-decimal gap-4 pl-5">
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>Add a property → &ldquo;Domain&rdquo;</strong> and enter{" "}
                    <CopyText value={tenant.domain.replace(/^www\./, "")} />
                  </span>
                  <span className="text-muted-foreground">
                    Google shows a <code>TXT</code> record like{" "}
                    <code>google-site-verification=…</code>. Add it in the domain&apos;s DNS (host{" "}
                    <code>@</code>), wait a few minutes, then click <em>Verify</em>. This is the
                    recommended way: one property covers www and non-www, http and https. Nothing
                    needs saving here.
                  </span>
                </div>
              </li>
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>Or, if you can&apos;t edit DNS:</strong> add a &ldquo;URL prefix&rdquo;
                    property for <CopyText value={`${home}/`} />, choose the <em>HTML tag</em>{" "}
                    method, paste the tag below and save, then click <em>Verify</em>.
                  </span>
                </div>
              </li>
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>Sitemaps → Add a new sitemap:</strong> <CopyText value={sitemap} />
                  </span>
                  <span className="text-muted-foreground">
                    It lists the home page, shop, every category, every product and the written
                    info pages, and updates itself as products are added — submit it once. Status
                    should turn to &ldquo;Success&rdquo; within a day.
                  </span>
                </div>
              </li>
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>URL Inspection:</strong> paste <CopyText value={home} /> and click{" "}
                    <em>Request indexing</em> to get the home page crawled sooner.
                  </span>
                </div>
              </li>
              <li className="text-muted-foreground">
                <strong className="text-foreground">Then wait.</strong> New sites usually take
                days to a few weeks to show up. Check <em>Indexing → Pages</em> for problems.
                Old <code>/store/{tenant.slug}</code> links redirect here and every page&apos;s
                canonical tag points at this domain, so Google consolidates onto it.
              </li>
              <li className="text-muted-foreground">
                <strong className="text-foreground">Optional — Bing:</strong> in Bing Webmaster
                Tools, &ldquo;Import from Google Search Console&rdquo; copies the verified site
                and sitemap in one step.
              </li>
            </ol>
          ) : (
            <ol className="grid list-decimal gap-4 pl-5">
              <li>
                <strong>Best:</strong> connect a custom domain first (Domain section), then come
                back — the steps here switch to that domain.
              </li>
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>Platform-wide (once):</strong> verify{" "}
                    <code>{new URL(env.baseUrl).hostname}</code> as a Domain property and submit{" "}
                    <CopyText value={platformSitemap} />
                  </span>
                </div>
              </li>
              <li>
                <div className="grid gap-1.5">
                  <span>
                    <strong>Or a property just for this store:</strong> add a &ldquo;URL
                    prefix&rdquo; property for <CopyText value={`${home}/`} />, choose the{" "}
                    <em>HTML tag</em> method, paste the tag below, save, click <em>Verify</em>,
                    then submit <CopyText value={sitemap} /> in that property.
                  </span>
                </div>
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search Console verification tag</CardTitle>
          <CardDescription>
            Only for the HTML-tag method. Added to every page of this store, and nowhere else.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerificationForm slug={tenant.slug} initial={googleSiteVerification} />
        </CardContent>
      </Card>
    </>
  );
}
