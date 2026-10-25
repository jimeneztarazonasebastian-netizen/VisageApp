import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// The vision engine is served from /vendor/mediapipe/<version> (see scripts/copy-vision.mjs).
const mediapipe = JSON.parse(readFileSync("node_modules/@mediapipe/tasks-vision/package.json", "utf8")).version as string;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_MEDIAPIPE_VERSION: mediapipe },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Photos never leave the phone except through our own /api/ia: the page may only talk to
          // its own server (this also stops the vision library's usage pings to Google).
          { key: "Content-Security-Policy", value: "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      // Models and the vision engine never change under the same name: cache them for a long time.
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // Versioned folder: safe to cache for good.
      { source: "/vendor/mediapipe/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/vendor/precache.json", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
