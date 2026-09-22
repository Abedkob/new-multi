import { requirePlatformAdmin } from "@/lib/session";
import { CreateStoreForm } from "./create-store-form";

export default async function NewStorePage() {
  await requirePlatformAdmin();
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New store</h1>
        <p className="text-muted-foreground">
          Creates the store and its owner account with a one-time password.
        </p>
      </div>
      <CreateStoreForm />
    </div>
  );
}
