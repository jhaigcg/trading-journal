import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // loaded by Node at runtime instead of being bundled (the LZMA decoder has a layout the bundler cannot follow)
  serverExternalPackages: ["lzma"],
  // the EA source is read from disk at request time, so make sure it ships with the serverless bundle
  outputFileTracingIncludes: { "/api/ea/download": ["./mt4/**/*"] },
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
