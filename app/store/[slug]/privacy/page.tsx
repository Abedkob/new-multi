import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CookieSettingsLink } from "@/components/consent/cookie-settings-link";
import { consentCopy, fillConsentTokens } from "@/lib/consent/copy";
import { CONSENT_COOKIE_PREFIX } from "@/lib/consent/cookie";
import { readStoreConsent, tenantLocale } from "@/lib/consent/read";
import { isConsentLocale } from "@/lib/consent/types";
import { loadTenant } from "@/lib/data/storefront";
import { env } from "@/lib/env";
import { canServeTenant } from "@/lib/license/status";
import { pageMeta } from "@/lib/seo";
import { getTemplate } from "@/templates";

export const dynamic = "force-dynamic";

/**
 * The visitor-facing privacy page: who is responsible for measurement here, what is measured,
 * what is never stored, how long it is kept, and how to change your mind (§4.1, §4.7).
 *
 * Reachable at /store/<slug>/privacy and, for a store on its own domain, at <domain>/privacy —
 * proxy.ts rewrites a custom-domain request to this same route, so one page serves both.
 *
 * It renders inside the storefront layout, so the consent provider is above it and the Cookie
 * settings button here opens the same dialog the footer does.
 */

export async function generateMetadata({
  params,
}: PageProps<"/store/[slug]/privacy">): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant) return {};
  const copy = consentCopy(tenantLocale(tenant));
  return pageMeta({
    tenant,
    path: "/privacy",
    title: copy.privacy.title,
    description: fillConsentTokens(copy.privacy.intro, { store: tenant.name }),
  });
}

export default async function StorePrivacyPage({
  params,
  searchParams,
}: PageProps<"/store/[slug]/privacy">) {
  const { slug } = await params;
  const tenant = await loadTenant(slug);
  if (!tenant || !canServeTenant(tenant)) notFound();

  const consent = await readStoreConsent(tenant);
  // ?lang= lets a visitor read this page in the other language without having to make a consent
  // choice first; otherwise it follows their recorded choice, then the store's default.
  const requested = (await searchParams).lang;
  const locale = isConsentLocale(requested) ? requested : consent.locale;
  const copy = consentCopy(locale);
  const p = copy.privacy;

  const s = getTemplate(tenant.templateId).pageStyle;
  const otherLang = locale === "en" ? "ar" : "en";

  return (
    <article className={s.container} dir={copy.dir} data-testid="privacy-page">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className={s.title}>{p.title}</h1>
        <a
          href={`?lang=${otherLang}`}
          lang={otherLang}
          data-testid="privacy-language-switch"
          className="inline-flex min-h-10 items-center text-sm underline underline-offset-4 hover:text-primary"
        >
          {copy.otherLanguageLabel}
        </a>
      </div>

      <div className="mt-8 grid max-w-3xl gap-10 leading-relaxed">
        <p className="text-base">{fillConsentTokens(p.intro, { store: tenant.name })}</p>

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">{p.controllersTitle}</h2>
          <p className="text-sm text-muted-foreground">{p.controllersBody}</p>
          <dl className="grid gap-4 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {p.merchantLabel}
              </dt>
              <dd>{tenant.privacyControllerName || tenant.name}</dd>
              {tenant.privacyEmail && (
                <dd className="text-muted-foreground">
                  {p.contactLabel}:{" "}
                  <a className="underline underline-offset-4" href={`mailto:${tenant.privacyEmail}`}>
                    {tenant.privacyEmail}
                  </a>
                </dd>
              )}
              {tenant.privacyPolicyUrl && (
                <dd>
                  <a
                    className="underline underline-offset-4"
                    href={tenant.privacyPolicyUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {p.policyLabel}
                  </a>
                </dd>
              )}
            </div>
            <div className="grid gap-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {p.platformLabel}
              </dt>
              <dd>{env.PLATFORM_PRIVACY_NAME ?? "—"}</dd>
              {env.PLATFORM_PRIVACY_EMAIL && (
                <dd className="text-muted-foreground">
                  {p.contactLabel}:{" "}
                  <a
                    className="underline underline-offset-4"
                    href={`mailto:${env.PLATFORM_PRIVACY_EMAIL}`}
                  >
                    {env.PLATFORM_PRIVACY_EMAIL}
                  </a>
                </dd>
              )}
              {env.PLATFORM_PRIVACY_URL && (
                <dd>
                  <a
                    className="underline underline-offset-4"
                    href={env.PLATFORM_PRIVACY_URL}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {p.policyLabel}
                  </a>
                </dd>
              )}
            </div>
          </dl>
        </section>

        <Bullets title={p.measureTitle} items={p.measureItems} />
        <Bullets title={p.neverTitle} items={p.neverItems} />
        <Bullets title={p.retentionTitle} items={p.retentionItems} />

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">{p.cookiesTitle}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start">
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    {p.cookieNameHeading}
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    {p.cookiePurposeHeading}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {p.cookieLifeHeading}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="py-3 pe-4 font-mono text-xs">{CONSENT_COOKIE_PREFIX}&hellip;</td>
                  <td className="py-3 pe-4 text-muted-foreground">{p.cookieConsentPurpose}</td>
                  <td className="py-3 text-muted-foreground">{p.cookieConsentLife}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">{p.rightsTitle}</h2>
          <p className="text-sm text-muted-foreground">{p.rightsBody}</p>
          {consent.publicRef ? (
            <p className="text-sm">
              <span className="font-medium">{copy.manage.referenceLabel}:</span>{" "}
              <span className="font-mono text-xs" data-testid="privacy-reference">
                {consent.publicRef}
              </span>
              <span className="block text-xs text-muted-foreground">
                {copy.manage.referenceHint}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{p.noDecisionYet}</p>
          )}
          <div>
            <CookieSettingsLink className="rounded-md border border-foreground/30 px-4 text-sm font-semibold hover:bg-foreground/5" />
          </div>
        </section>
      </div>
    </article>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <ul className="grid gap-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
