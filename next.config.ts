import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is intentionally left off: every page in this app is
  // per-user and must be rendered at request time, so there is nothing to
  // prerender and the classic dynamic rendering model is simpler to reason about.
  images: {
    // Google profile photos.
    remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
