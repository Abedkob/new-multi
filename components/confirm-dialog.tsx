"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * An in-app "are you sure?" modal (replaces the browser's window.confirm, which looks like an
 * error and can't be styled). Controlled: the caller decides what confirming does.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <AlertDialog.Popup
          data-testid="confirm-dialog"
          className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-background p-6 text-foreground shadow-2xl transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
        >
          <div className="flex gap-4">
            {destructive && (
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400">
                <AlertTriangle className="size-5" aria-hidden />
              </span>
            )}
            <div className="grid gap-1.5">
              <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
              {description && (
                <AlertDialog.Description className="text-sm text-muted-foreground">
                  {description}
                </AlertDialog.Description>
              )}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button variant="outline" />}>{cancelLabel}</AlertDialog.Close>
            <Button
              variant={destructive ? "destructive" : "default"}
              className={cn(destructive && "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600")}
              data-testid="confirm-dialog-confirm"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * A submit button for a form that asks first: clicking opens the modal, and confirming submits
 * the button's own form (so server actions, useFormStatus and useActionState all work as before).
 */
export function ConfirmSubmitButton({
  children,
  title,
  description,
  confirmLabel,
  destructive = true,
  ...buttonProps
}: Omit<ButtonProps, "type" | "onClick" | "title"> & {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} type="button" onClick={() => setOpen(true)} {...buttonProps}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onConfirm={() => ref.current?.form?.requestSubmit()}
      />
    </>
  );
}
