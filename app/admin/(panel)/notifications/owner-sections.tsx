"use client";

import {
  registerDeviceAction,
  removeDeviceAction,
  saveOwnerPreferencesAction,
  sendTestNotificationAction,
} from "./actions";
import {
  DeviceList,
  PreferenceToggles,
  PushStatus,
  type DeviceRow,
  type ToggleRow,
} from "@/components/admin/notifications";
import type { OwnerPreferences } from "@/lib/data/notification-preferences";
import { useT } from "@/lib/i18n/context";

/**
 * The owner's half of `/admin/notifications`: the shared sections, wired to the owner's actions
 * and the owner's dictionary.
 *
 * This is the only place the merchant's wording is assembled. The components themselves take
 * every string as a prop so the platform console can mount the same behaviour in English
 * without dragging Arabic into an internal operations screen (§11.9).
 */
export function OwnerNotificationSections({
  vapidPublicKey,
  preferences,
  devices,
}: {
  vapidPublicKey: string | null;
  preferences: OwnerPreferences;
  devices: DeviceRow[];
}) {
  const t = useT();

  const rows: ToggleRow<keyof OwnerPreferences & string>[] = [
    { key: "newOrders", label: t("notifications.type.newOrders"), hint: t("notifications.type.newOrders.hint") },
    { key: "weeklySummary", label: t("notifications.type.weeklySummary"), hint: t("notifications.type.weeklySummary.hint") },
    { key: "productAlerts", label: t("notifications.type.productAlerts"), hint: t("notifications.type.productAlerts.hint") },
    { key: "funnelAlerts", label: t("notifications.type.funnelAlerts"), hint: t("notifications.type.funnelAlerts.hint") },
    { key: "searchAlerts", label: t("notifications.type.searchAlerts"), hint: t("notifications.type.searchAlerts.hint") },
    { key: "trafficAlerts", label: t("notifications.type.trafficAlerts"), hint: t("notifications.type.trafficAlerts.hint") },
    {
      key: "lowStockAlerts",
      label: t("notifications.type.lowStockAlerts"),
      hint: t("notifications.type.lowStockAlerts.hint"),
    },
  ];

  return (
    <>
      <PushStatus
        vapidPublicKey={vapidPublicKey}
        register={async (input) => {
          const result = await registerDeviceAction(input);
          return result.error
            ? { error: t(result.error as "notifications.error.unavailable") }
            : {};
        }}
        sendTest={async () => {
          const result = await sendTestNotificationAction();
          return result.error
            ? { error: t(result.error as "notifications.error.noDevices") }
            : {};
        }}
        copy={{
          heading: t("notifications.push.heading"),
          install: t("notifications.push.install"),
          installed: t("notifications.push.installed"),
          notInstalled: t("notifications.push.notInstalled"),
          permission: t("notifications.push.permission"),
          granted: t("notifications.status.granted"),
          denied: t("notifications.status.denied"),
          notAsked: t("notifications.status.notAsked"),
          unsupported: t("notifications.status.unsupported"),
          unsupportedHelp: t("notifications.status.unsupportedHelp"),
          deniedHelp: t("notifications.status.deniedHelp"),
          enable: t("notifications.push.enable"),
          test: t("notifications.push.test"),
          refused: t("notifications.status.refused"),
          enabled: t("notifications.status.enabled"),
          failed: t("notifications.status.failed"),
          testSent: t("notifications.status.testSent"),
        }}
      />

      <PreferenceToggles
        rows={rows}
        values={preferences as Record<keyof OwnerPreferences & string, boolean>}
        save={(next) => saveOwnerPreferencesAction(next as OwnerPreferences)}
        copy={{
          heading: t("notifications.types.heading"),
          description: t("notifications.types.description"),
          auto: t("notifications.types.auto"),
          saving: t("notifications.types.saving"),
          saved: t("notifications.types.saved"),
        }}
        // The one switch that changes what lands on a lock screen (D50), apart from the rest.
        highlighted={{
          row: {
            key: "showOrderAmount",
            label: t("notifications.amount.label"),
            hint: t("notifications.amount.hint"),
          },
          warning: t("notifications.amount.privacy"),
        }}
      />

      <DeviceList
        devices={devices}
        remove={async (id) => {
          const result = await removeDeviceAction(id);
          return result.error
            ? { error: t(result.error as "notifications.error.deviceGone") }
            : {};
        }}
        copy={{
          heading: t("notifications.devices.heading"),
          none: t("notifications.devices.none"),
          added: t("notifications.devices.added"),
          lastDelivery: t("notifications.devices.lastDelivery"),
          neverDelivered: t("notifications.devices.neverDelivered"),
          expired: t("notifications.devices.expired"),
          remove: t("notifications.devices.remove"),
          note: t("notifications.devices.note"),
        }}
      />
    </>
  );
}
