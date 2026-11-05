"use client";

import {
  registerPlatformDeviceAction,
  removePlatformDeviceAction,
  savePlatformPreferencesAction,
  sendPlatformTestAction,
} from "./actions";
import {
  DeviceList,
  PreferenceToggles,
  PushStatus,
  type DeviceRow,
  type ToggleRow,
} from "@/components/admin/notifications";
import type { PlatformPreferences } from "@/lib/data/notification-preferences";

/**
 * The platform console's notification sections (§11.9).
 *
 * The same three components the merchant's screen uses, with the platform's actions and the
 * platform's wording. English only, deliberately: these go to this platform's own operators,
 * and §5.9's bilingual requirement is about the merchant dashboard and the storefront.
 *
 * There is no "show the amount" switch here. A platform alert names a store, never an order,
 * and never a sum of money — so there would be nothing for such a toggle to reveal.
 */

const ROWS: readonly ToggleRow<keyof PlatformPreferences & string>[] = [
  {
    key: "inactiveStoreAlerts",
    label: "Store went quiet",
    hint: "No visit, order or WhatsApp message for seven days. Once when it happens, not every run.",
  },
  {
    key: "storeDeclineAlerts",
    label: "Store declining",
    hint: "Traffic or orders at least halved, against a baseline worth comparing to.",
  },
  {
    key: "ingestionHealthAlerts",
    label: "Ingestion failing",
    hint: "Events dropped, and events our own code sends that the contract refuses — a 400 means we are losing data.",
  },
  {
    key: "aggregationHealthAlerts",
    label: "Aggregation behind",
    hint: "The last successful run is over 20 minutes old, a run failed, or a lease expired.",
  },
  {
    key: "redisFallbackAlerts",
    label: "Redis unavailable",
    hint: "Rate limiting has fallen back to in-memory, so limits are per instance.",
  },
  {
    key: "pushDeliveryAlerts",
    label: "Push delivery failing",
    hint: "A meaningful share of notifications is not reaching devices.",
  },
  {
    key: "weeklyPlatformSummary",
    label: "Weekly summary",
    hint: "Monday morning: active stores, growing and declining, ingestion and aggregation health.",
  },
];

export function PlatformNotificationSections({
  vapidPublicKey,
  preferences,
  devices,
}: {
  vapidPublicKey: string | null;
  preferences: PlatformPreferences;
  devices: DeviceRow[];
}) {
  return (
    <>
      <PushStatus
        vapidPublicKey={vapidPublicKey}
        register={registerPlatformDeviceAction}
        sendTest={sendPlatformTestAction}
        copy={{
          heading: "This device",
          install: "Installed as an app",
          installed: "Yes",
          notInstalled: "No — you are using it in the browser",
          permission: "Permission",
          granted: "Allowed",
          denied: "Blocked",
          notAsked: "Not asked yet",
          unsupported: "This browser cannot show notifications",
          unsupportedHelp:
            "On an iPhone or iPad, add this console to your Home Screen in Safari and open it from there.",
          deniedHelp:
            "Notifications are blocked for this site in your browser settings. Allow them there first.",
          enable: "Enable notifications",
          test: "Send a test notification",
          refused: "You chose not to allow notifications.",
          enabled: "This device will now receive platform notifications.",
          failed: "This device could not be registered.",
          testSent: "Sent. If nothing appears within a few seconds, check this device's settings.",
        }}
      />

      <PreferenceToggles
        rows={ROWS}
        values={preferences as Record<keyof PlatformPreferences & string, boolean>}
        save={(next) => savePlatformPreferencesAction(next as PlatformPreferences)}
        copy={{
          heading: "What to alert me about",
          description:
            "All on by default. Every alert fires once when the condition starts and respects a cooldown, so a problem that stays a problem does not notify every five minutes.",
          auto: "Changes save as you make them.",
          saving: "Saving…",
          saved: "Saved.",
        }}
      />

      <DeviceList
        devices={devices}
        remove={removePlatformDeviceAction}
        copy={{
          heading: "Your devices",
          none: "No device is registered yet. Choose “Enable notifications” above.",
          added: "Added",
          lastDelivery: "last notification",
          neverDelivered: "nothing delivered yet",
          expired: "needs enabling again",
          remove: "Remove",
          note: "Removing a device stops notifications on it only. Your choices above and your other devices are unaffected.",
        }}
      />
    </>
  );
}
