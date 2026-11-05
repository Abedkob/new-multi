import { PageHeader } from "@/components/admin/page-header";
import { ensureOwnerPreferences } from "@/lib/data/notification-preferences";
import { listDevices } from "@/lib/data/push-subscriptions";
import { pushConfigured, vapidPublicKey } from "@/lib/push/keys";
import { getT } from "@/lib/i18n/locale";
import { requireOwner } from "@/lib/session";
import { DeviceList } from "./device-list";
import { IphoneGuide } from "./iphone-guide";
import { PreferenceForm } from "./preference-form";
import { PushStatus } from "./push-status";

/**
 * Notifications (§11.2): the owner's own phone, in three sections.
 *
 * Its own screen rather than a tab under Marketing or a block in Settings, because it is the
 * only page whose subject is the device in the owner's hand — and because the iPhone
 * instructions need room to be read rather than a tooltip.
 *
 * With push unconfigured this page still renders and says so (P6-31). A deployment without
 * VAPID keys is a supported state, not a broken one, and an Enable button that cannot work is
 * worse than a sentence explaining why there isn't one.
 */
export default async function NotificationsPage() {
  const owner = await requireOwner();
  const t = await getT();
  const [preferences, devices] = await Promise.all([
    ensureOwnerPreferences(owner.userId),
    listDevices(owner.userId, "OWNER"),
  ]);

  return (
    <div className="grid gap-4">
      <PageHeader
        title={t("notifications.page.title")}
        description={t("notifications.page.description")}
      />

      {!pushConfigured() ? (
        <p
          className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
          data-testid="push-unconfigured"
        >
          {t("notifications.unavailable")}
        </p>
      ) : (
        <PushStatus vapidPublicKey={vapidPublicKey()} />
      )}

      <PreferenceForm initial={preferences} />

      <DeviceList
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
