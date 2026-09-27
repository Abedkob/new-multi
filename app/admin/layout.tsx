import { getLocale } from "@/lib/i18n/locale";
import { LocaleProvider } from "@/lib/i18n/context";

/**
 * The actual RTL/locale mount point for the whole /admin subtree — not just the (panel) route
 * group, since /admin/content, /admin/preview, and /admin/change-password render outside it.
 * `dir`/`lang` are scoped to this wrapper (never the shared root <html>) so the storefront and
 * platform admin stay untouched. `display: contents` keeps the wrapper invisible to (panel)
 * layout's own flex structure.
 */
export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} lang={locale} className="contents">
      <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
    </div>
  );
}
