import { IphoneGuide } from "@/components/admin/notifications/iphone-guide";
import { ensurePlatformPreferences } from "@/lib/data/notification-preferences";
import { listDevices } from "@/lib/data/push-subscriptions";
import { pushConfigured, vapidPublicKey } from "@/lib/push/keys";
import { PageHeader } from "@/components/admin/page-header";
import { requirePlatformAdmin } from "@/lib/session";
import { PlatformNotificationSections } from "./platform-sections";

/**
 * Platform notifications (§11.9): the same three sections as the merchant's screen, tagged
 * PLATFORM so the two inboxes cannot cross.
 *
 * A platform admin's subscription carries no tenant, so nothing tenant-scoped can reach it, and
 * every lookup here passes the audience. A merchant never receives a platform alert and a
 * platform admin never receives a store's orders — checked in verify:notifications (P6-19).
 */
export default async function PlatformNotificationsPage() {
  const admin = await requirePlatformAdmin();
  const [preferences, devices] = await Promise.all([
    ensurePlatformPreferences(admin.userId),
    listDevices(admin.userId, "PLATFORM"),
  ]);

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Notifications"
        description="Alerts about the platform itself: stores going quiet or declining, ingestion and aggregation health, Redis, and push delivery. Store names appear; customer and order data never does."
      />

      {!pushConfigured() ? (
        <p
          className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
          data-testid="push-unconfigured"
        >
          Notifications are not configured on this platform. Set the PUSH_* environment variables
          to enable them.
        </p>
      ) : null}

      <PlatformNotificationSections
        vapidPublicKey={pushConfigured() ? vapidPublicKey() : null}
        preferences={preferences}
        devices={devices.map((device) => ({
          id: device.id,
          deviceLabel: device.deviceLabel,
          createdAt: device.createdAt.toISOString(),
          lastSuccessAt: device.lastSuccessAt?.toISOString() ?? null,
          expired: !!device.expiredAt,
        }))}
      />

      <IphoneGuide />
    </div>
  );
}
