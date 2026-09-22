import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOwner } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const owner = await requireOwner({ allowMustChange: true });
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            Signed in as {owner.email}. You must set your own password before
            using the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
