import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The admin's form fields. See ADMIN_UI.md §5.
 *
 * **Why this file grew.** `Field` wrapped `<Input>` and nothing else, so a form dropped out of it
 * at its first `<select>`, `<Textarea>` or `Switch` — and once one field in a file is hand-rolled
 * the rest follow, for consistency inside that file. That is why the admin panel had `Field` in
 * one file out of 84 while the platform console used it everywhere: the console's forms are all
 * plain text inputs. The gap was in the component, not in anybody's discipline.
 *
 * So there is one member per kind of control, all sharing `FieldShell`, and the four things a
 * field owes its reader are decided once:
 *
 *   1. The label is bound to the control by id.
 *   2. The hint and the error are bound by `aria-describedby`, so a screen reader reads the
 *      complaint with the field instead of leaving it to be found by eye. The hand-rolled forms
 *      did this and `Field` did not — adopting `Field` used to be an accessibility downgrade.
 *   3. A hint and an error never show at once. A field does not give advice and a complaint in
 *      the same breath.
 *   4. `aria-invalid` follows the errors, never a separate flag that can disagree with them.
 *
 * `errors` are **already-resolved strings**. Callers hold the dictionary (`resolveMessage(t, e)`),
 * because this module has no hooks and must stay renderable from a Server Component.
 */

/** The id an error is published under, so a control can point at it. */
const errorId = (name: string) => `${name}-error`;
const hintId = (name: string) => `${name}-help`;

/**
 * What every control in this file spreads onto itself. One place, so a field cannot be invalid
 * without saying so, or describe a hint it is not showing.
 */
export function fieldAria(name: string, errors?: string[], hint?: React.ReactNode) {
  const invalid = !!errors?.length;
  return {
    id: name,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId(name) : hint ? hintId(name) : undefined,
  } as const;
}

export function FieldShell({
  name,
  label,
  /** The translated word for "optional". Passed in, since this module holds no dictionary. */
  optional,
  hint,
  errors,
  className,
  children,
}: {
  name: string;
  label?: React.ReactNode;
  optional?: React.ReactNode;
  hint?: React.ReactNode;
  errors?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label && (
        <Label htmlFor={name}>
          {label}
          {optional && <span className="font-normal text-muted-foreground">{optional}</span>}
        </Label>
      )}
      {children}
      {hint && !errors?.length && (
        <p id={hintId(name)} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errors?.map((e) => (
        <p id={errorId(name)} key={e} className="text-sm text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

type ShellProps = {
  label?: React.ReactNode;
  name: string;
  errors?: string[];
  hint?: React.ReactNode;
  optional?: React.ReactNode;
  /** Classes for the field's wrapper, not the control. */
  fieldClassName?: string;
};

export function Field({
  label,
  name,
  errors,
  hint,
  optional,
  fieldClassName,
  ...props
}: React.ComponentProps<typeof Input> & ShellProps) {
  return (
    <FieldShell
      name={name}
      label={label}
      optional={optional}
      hint={hint}
      errors={errors}
      className={fieldClassName}
    >
      <Input name={name} {...fieldAria(name, errors, hint)} {...props} />
    </FieldShell>
  );
}

/**
 * A number with a currency or percent affix.
 *
 * **This is the one place in the admin that uses physical-direction classes, and it is
 * deliberate** (ADMIN_UI.md §8): a currency affix stays on the LTR side whatever the locale,
 * because the project's numeric formatting is a stated non-goal — figures are rendered in Latin
 * digits with a leading `$` in both languages, so flipping only the affix would read as a bug.
 * Keeping it here means the two forms that need it carry no direction classes of their own, and
 * the exemption is written down once instead of twice.
 *
 * admin-ui-allow-physical: a currency/percent affix is positioned LTR in both locales.
 */
export function AffixField({
  label,
  name,
  errors,
  hint,
  optional,
  fieldClassName,
  prefix,
  suffix,
  className,
  ...props
}: React.ComponentProps<typeof Input> &
  ShellProps & { prefix?: React.ReactNode; suffix?: React.ReactNode }) {
  return (
    <FieldShell
      name={name}
      label={label}
      optional={optional}
      hint={hint}
      errors={errors}
      className={fieldClassName}
    >
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          name={name}
          className={cn("tabular-nums", prefix && "pl-7", suffix && "pr-8", className)}
          {...fieldAria(name, errors, hint)}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

export function TextareaField({
  label,
  name,
  errors,
  hint,
  optional,
  fieldClassName,
  ...props
}: React.ComponentProps<typeof Textarea> & ShellProps) {
  return (
    <FieldShell
      name={name}
      label={label}
      optional={optional}
      hint={hint}
      errors={errors}
      className={fieldClassName}
    >
      <Textarea name={name} {...fieldAria(name, errors, hint)} {...props} />
    </FieldShell>
  );
}

/**
 * A `<select>` that looks like an `Input`, because it is one kind of input.
 *
 * It had three spellings before this: `h-8 rounded-lg` in the category form, `h-9 rounded-lg
 * border bg-background px-3` in the coupon form, and `h-9 rounded-md … shadow-xs` in the platform
 * console's own local copy. The classes here are `Input`'s, so a select and a text box on the same
 * row are the same height and the same shape.
 */
export function SelectField({
  label,
  name,
  errors,
  hint,
  optional,
  fieldClassName,
  options,
  className,
  children,
  ...props
}: React.ComponentProps<"select"> &
  ShellProps & { options?: { value: string; label: string }[] }) {
  return (
    <FieldShell
      name={name}
      label={label}
      optional={optional}
      hint={hint}
      errors={errors}
      className={fieldClassName}
    >
      <select
        name={name}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
          className,
        )}
        {...fieldAria(name, errors, hint)}
        {...props}
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
    </FieldShell>
  );
}

/**
 * A switch with its label and explanation beside it, not above it.
 *
 * A different layout from the others on purpose: a switch is a thing you flip while reading the
 * sentence next to it, so the control sits at the end of the row rather than under a label. The
 * row is a nested box (`rounded-md border bg-background`) when `boxed`, which is how it appears
 * inside a panel of other fields.
 */
export function SwitchField({
  label,
  name,
  hint,
  errors,
  boxed = true,
  className,
  ...props
}: React.ComponentProps<typeof Switch> & {
  label: React.ReactNode;
  name: string;
  hint?: React.ReactNode;
  errors?: string[];
  boxed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        boxed && "rounded-md border bg-background p-4",
        className,
      )}
    >
      <div className="grid min-w-0 gap-1">
        <Label htmlFor={name}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {errors?.map((e) => (
          <p key={e} className="text-sm text-destructive">
            {e}
          </p>
        ))}
      </div>
      <Switch id={name} aria-invalid={!!errors?.length || undefined} {...props} />
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * The row a form ends with: the submit, then whatever it has to say about the last attempt.
 *
 * Four admin forms carried this markup verbatim — the sticky bar, the blur, the shadow — and one
 * of them had drifted (`rounded-xl` in three, a shorter class list in the fourth). Sticky from
 * `sm` up so a long form can be saved without scrolling to the end, and a plain row on a phone,
 * where a fixed bar eats the viewport.
 */
export function FormActions({
  children,
  status,
  error,
  className,
}: {
  children: React.ReactNode;
  /** Resolved "saved" text, shown as a polite status. */
  status?: string;
  /** Resolved failure text. */
  error?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 sm:sticky sm:bottom-3 sm:z-10 sm:-mx-1 sm:bg-card/95 sm:shadow-lg sm:backdrop-blur",
        className,
      )}
    >
      {children}
      {status && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {status}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
