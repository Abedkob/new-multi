import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
