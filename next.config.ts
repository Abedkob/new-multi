import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Development only (ignored by a production build). `next dev` refuses to serve its dev
  // resources — HMR, fonts, the client bundle — to a page loaded from a hostname it does not
  // recognise, which breaks any local test of the custom-domain routing in proxy.ts: the page
  // renders but its JavaScript never arrives, so nothing on it works. pnpm e2e:consent drives
  // exactly that path, resolving this hostname to 127.0.0.1 through Chrome itself.
  // Add your own test domains here if you need to exercise custom-domain behaviour locally.
  allowedDevOrigins: [
    "consent-e2e.test",
    "analytics-e2e.test",
    "checkout-e2e.test",
    "categories-e2e.test",
    "variants-e2e.test",
    "discounts-e2e.test",
    "social-e2e.test",
    "pages-e2e.test",
    "kinetic-e2e.test",
    "mirage-e2e.test",
    "prism-e2e.test",
  ],
  experimental: {
    serverActions: {
      // Image uploads go through a Server Action (uploadImageAction) and allow up to 5MB
      // (lib/storage.ts); the default 1MB cap would reject them before the action runs.
      bodySizeLimit: "6mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
    // Storefront photos (templates/shared.tsx's Picture) ask for quality 90, not the 75
    // default, so they need to be allow-listed here or Next warns on every render.
    qualities: [75, 90],
  },
  async headers() {
    return [
      {
        // Owner-uploaded files (app/admin/content/actions.ts) are served from the platform's own
        // origin. The upload action only accepts sniffed raster images now, but files uploaded
        // before that (e.g. an SVG) may still be on disk: a sandbox CSP stops anything opened
        // directly from running script with a viewer's session. Doesn't affect <img> embedding.
        source: "/uploads/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
