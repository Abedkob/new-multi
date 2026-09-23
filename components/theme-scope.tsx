import { fontVars, googleFontsHref, type ThemeFonts } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { themeStyle, type ThemeColors } from "@/lib/theme";

/** Root wrapper that injects a store's color and font CSS variables. Used by the
 * storefront layout, the admin live preview and the template gallery. */
export function ThemeScope({
  colors,
  fonts = {},
  className,
  children,
}: {
  colors: ThemeColors;
  /** Fonts picked in the theme editor; unset ones keep the template's own. */
  fonts?: ThemeFonts;
  className?: string;
  children: React.ReactNode;
}) {
  const href = googleFontsHref([fonts.headingFont, fonts.bodyFont]);
  return (
    <div
      data-theme-scope
      data-heading-font={fonts.headingFont ? "" : undefined}
      style={{
        ...themeStyle(colors),
        ...fontVars(fonts),
        ...(fonts.bodyFont ? { fontFamily: "var(--font-sans)" } : {}),
      }}
      className={cn("bg-background text-foreground", className)}
    >
      {/* React hoists this into <head>; only the store's own 1-2 fonts are loaded. */}
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      {children}
    </div>
  );
}
