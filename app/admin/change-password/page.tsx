import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveMessage } from "@/lib/i18n/context";
import { getT } from "@/lib/i18n/locale";
import { encodeMessage } from "@/lib/i18n/types";
import { requireOwner } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const owner = await requireOwner({ allowMustChange: true });
  const t = await getT();
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("changePassword.title")}</CardTitle>
          <CardDescription>
            {resolveMessage(t, encodeMessage("changePassword.signedInAs", owner.email))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
