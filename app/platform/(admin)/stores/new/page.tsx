import { env } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/session";
import { describeTimeZone, listTimeZones } from "@/lib/time-zones";
import { CreateStoreForm } from "./create-store-form";

export default async function NewStorePage() {
  await requirePlatformAdmin();
  // Built here rather than in the browser so the option list is identical for every operator
  // and cannot differ between server render and hydration.
  const timeZones = listTimeZones().map((value) => ({
    value,
    label: describeTimeZone(value),
  }));
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New store</h1>
        <p className="text-muted-foreground">
          Creates the store and its owner account with a one-time password.
        </p>
      </div>
      <CreateStoreForm
        timeZones={timeZones}
        defaultTimeZone={env.PLATFORM_TIMEZONE}
        defaultLocale={env.PLATFORM_DEFAULT_LOCALE}
      />
    </div>
  );
}
