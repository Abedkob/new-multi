import { cn } from "@/lib/utils";
import { themeStyle, type ThemeColors } from "@/lib/theme";

/** Root wrapper that injects a store's color CSS variables. Used by the
 * storefront layout, the admin live preview and the template gallery. */
export function ThemeScope({
  colors,
  className,
  children,
}: {
  colors: ThemeColors;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme-scope
      style={themeStyle(colors)}
      className={cn("bg-background text-foreground", className)}
    >
      {children}
    </div>
  );
}
