import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { JOINT_CONTROLLER_SUMMARY } from "@/lib/consent/agreement";
import { env } from "@/lib/env";
import { describeTimeZone, listTimeZones } from "@/lib/time-zones";
import { listPrivacyAudit } from "@/lib/analytics/privacy-request";
import { loadStore } from "../load";
import { AnalyticsPauseControl, StorePrivacyForm } from "./privacy-form";
import { PrivacyRequestControl } from "./privacy-request-control";

/**
 * Platform admin only: the store's privacy identity, its reporting basis, the joint-controller
 * record, and the analytics kill switch.
 *
 * Store owners do not get this page. The controller details are what the platform asserts about
 * the merchant on a public privacy page, and the joint-controller record is an audit trail about
 * an agreement between the platform and the merchant — neither is the owner's to edit.
 */
export default async function StorePrivacyPage({
  params,
}: PageProps<"/platform/stores/[slug]/privacy">) {
  const { slug } = await params;
  const tenant = await loadStore(slug);
  const timeZones = listTimeZones().map((value) => ({ value, label: describeTimeZone(value) }));
  const audit = await listPrivacyAudit(tenant.id);

  const recorded = tenant.jointControllerRecordedAt;
  const utc = (value: Date) =>
    `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value)} UTC`;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Privacy and reporting</CardTitle>
          <CardDescription>
            Shown to shoppers on this store&apos;s privacy page, and used to decide where its
            business day falls. A store cannot be put into the analytics rollout while the
            responsible business and contact are blank.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StorePrivacyForm
            slug={tenant.slug}
            timeZones={timeZones}
            values={{
              privacyControllerName: tenant.privacyControllerName ?? "",
              privacyEmail: tenant.privacyEmail ?? "",
              privacyPolicyUrl: tenant.privacyPolicyUrl ?? "",
              defaultLocale: tenant.defaultLocale,
              analyticsTimezone: tenant.analyticsTimezone,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Joint-controller record</CardTitle>
          <CardDescription>{JOINT_CONTROLLER_SUMMARY}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {tenant.jointControllerVersion ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-mono">{tenant.jointControllerVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recorded</dt>
                <dd>{recorded ? utc(recorded) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recorded by</dt>
                <dd className="font-mono text-xs">
                  {tenant.jointControllerRecordedBy ?? "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Not recorded yet. It is stamped automatically the first time this store&apos;s
              privacy settings are saved.
            </p>
          )}
          <p className="text-muted-foreground">
            Platform contact on this store&apos;s privacy page:{" "}
            <span className="font-mono text-xs">
              {env.PLATFORM_PRIVACY_NAME ?? "unset"}
              {env.PLATFORM_PRIVACY_EMAIL ? ` · ${env.PLATFORM_PRIVACY_EMAIL}` : ""}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shopper privacy requests</CardTitle>
          <CardDescription>
            Answer a &ldquo;what do you have about me&rdquo; or &ldquo;delete it&rdquo; request
            for this store. Store owners deliberately do not get this: a privacy request is a
            controller obligation that arrives to the platform, and an owner who could erase a
            visitor&apos;s trail could also erase the record of having done so. Every lookup,
            export and erasure here is logged below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PrivacyRequestControl slug={tenant.slug} audit={audit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pause measurement</CardTitle>
          <CardDescription>
            Stops first-party analytics for this store only. The storefront keeps selling and the
            consent notice still works — this is not the storefront pause in the danger zone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AnalyticsPauseControl
            slug={tenant.slug}
            pausedAt={tenant.analyticsPausedAt}
            pauseReason={tenant.analyticsPauseReason}
          />
        </CardContent>
      </Card>
    </div>
  );
}
