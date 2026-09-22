import { cn } from "@/lib/utils";

/** Small pill-style single-choice control used by the theme and content editors. */
export function Segmented({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <div className="flex rounded-lg border p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs",
              value === o.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
