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
