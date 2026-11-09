"use client";

import { useActionState, useState } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/admin/empty-state";
import { SectionCard } from "@/components/admin/section-card";
import { Field, FormError } from "@/components/field";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/context";
import type { DictionaryKey } from "@/lib/i18n/dictionaries/en";
import { addStaffAction, resetStaffPasswordAction, revokeStaffAction } from "./actions";
import type { StaffActionState } from "./actions";

export type StaffRow = {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  createdAt: string;
};

/**
 * Add, remove and reset. One client component rather than three, because the thing that has to
 * be shared between them is the first password: it exists for exactly one render, and a page
 * that re-fetched after a reset would lose it.
 */
export function StaffManager({ staff }: { staff: StaffRow[] }) {
  const t = useT();
  const [addState, addFormAction, adding] = useActionState<StaffActionState, FormData>(
    addStaffAction,
    {},
  );
  // A password from a reset, kept beside the row it belongs to.
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);

  const error = (key: string | undefined) => (key ? t(key as DictionaryKey) : null);

  return (
    <div className="grid gap-4">
      <SectionCard title={t("staff.add.title")} bodyClassName="grid gap-4">
        <form action={addFormAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          {/*
            These messages come from `staffAccountSchema` as plain English strings rather than
            dictionary keys, so they are passed straight through. Every other form in the admin
            encodes its errors and resolves them; this schema has not been converted yet.
          */}
          <Field
            label={t("common.name")}
            name="name"
            required
            defaultValue={addState.values?.name ?? ""}
            errors={addState.fieldErrors?.name}
          />
          <Field
            label={t("staff.add.email")}
            name="email"
            type="email"
            required
            defaultValue={addState.values?.email ?? ""}
            errors={addState.fieldErrors?.email}
          />
          <Button type="submit" disabled={adding}>
            {t("staff.add.submit")}
          </Button>
        </form>
        <FormError message={error(addState.error) ?? undefined} />
        {addState.firstPassword && (
          <FirstPassword password={addState.firstPassword} heading={t("staff.password.heading")} note={t("staff.password.note")} />
        )}
      </SectionCard>

      {staff.length === 0 ? (
        <SectionCard bodyClassName="p-0">
          <EmptyState icon={Users} title={t("staff.list.empty")} />
        </SectionCard>
      ) : (
        <SectionCard bodyClassName="grid gap-3" data-testid="staff-list">
          {staff.map((member) => (
            <div key={member.id} className="grid gap-2 border-b pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="grid">
                  <span className="font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">{member.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  {member.mustChangePassword && (
                    <span className="text-xs text-muted-foreground">
                      {t("staff.status.mustChange")}
                    </span>
                  )}
                  <RowButton
                    label={t("staff.resetPassword")}
                    variant="outline"
                    onRun={async () => {
                      const result = await resetStaffPasswordAction(member.id);
                      if (result.firstPassword) {
                        setReset({ id: member.id, password: result.firstPassword });
                      }
                    }}
                  />
                  <RowButton
                    label={t("staff.revoke")}
                    variant="destructive"
                    confirm={t("staff.revoke.confirm")}
                    onRun={async () => {
                      await revokeStaffAction(member.id);
                    }}
                  />
                </span>
              </div>
              {reset?.id === member.id && (
                <FirstPassword
                  password={reset.password}
                  heading={t("staff.password.heading")}
                  note={t("staff.password.note")}
                />
              )}
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}

/**
 * The one place a password is ever visible. Rendered as text rather than in an input, so no
 * browser offers to remember it, and marked as shown once because that is literally true — it
 * is not stored anywhere this screen could read it back from.
 */
function FirstPassword({
  password,
  heading,
  note,
}: {
  password: string;
  heading: string;
  note: string;
}) {
  return (
    <div className="grid gap-1 rounded-md bg-muted p-3" data-testid="first-password">
      <span className="text-xs font-medium">{heading}</span>
      <code className="font-mono text-sm break-all select-all">{password}</code>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

function RowButton({
  label,
  variant,
  confirm,
  onRun,
}: {
  label: string;
  variant: "outline" | "destructive";
  confirm?: string;
  onRun: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setPending(true);
        try {
          await onRun();
        } finally {
          setPending(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
