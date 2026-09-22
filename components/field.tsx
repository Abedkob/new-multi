import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  name,
  errors,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!errors?.length} {...props} />
      {hint && !errors?.length && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {errors?.map((e) => (
        <p key={e} className="text-sm text-destructive">
          {e}
        </p>
      ))}
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
