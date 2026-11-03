import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The Muse template's display serif. Loaded here rather than in the template: next/font only
// works inside Next's compiler, and templates are also imported by plain tsx scripts
// (verify:templates). Not preloaded, so pages that never use it don't fetch it.
const instrumentSerif = Instrument_Serif({
  variable: "--font-muse-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Multi-Tenant Stores",
  description: "Multi-tenant storefront platform",
  // The platform's own icon (admin, platform panel, login). Declared here rather than as
  // app/favicon.ico: a file-based icon would override every storefront's per-store favicon
  // (app/store/[slug]/layout.tsx), since file-based metadata beats generateMetadata.
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      {/* The platform's own GA is deliberately NOT here. A root layout has no pathname to
        * branch on, so anything mounted here runs on storefronts too — which both ignores the
        * shopper's consent decision and pollutes the platform's property with every store's
        * traffic. It is mounted per surface instead: see components/platform-analytics.tsx. */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
