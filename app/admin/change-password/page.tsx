import { SectionCard } from "@/components/admin/section-card";
import { getT } from "@/lib/i18n/locale";
import { encodeMessage, resolveMessage } from "@/lib/i18n/types";
import { requireTenantMember } from "@/lib/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const owner = await requireTenantMember({ allowMustChange: true });
  const t = await getT();
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4">
      {/*
        Centred rather than inside the panel shell, because this page is reached before the panel
        is usable. It still uses the admin's panel (ADMIN_UI.md §3) rather than `Card`: the rule
        has no "outside the shell" exception, and one would have to be argued for every time.
      */}
      <SectionCard
        className="w-full max-w-sm"
        title={t("changePassword.title")}
        description={resolveMessage(
          t,
          encodeMessage("changePassword.signedInAs", owner.email),
        )}
      >
        <ChangePasswordForm />
      </SectionCard>
    </main>
  );
}
