import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist"],
  devIndicators: {
    position: "bottom-right",
  },
  allowedDevOrigins: [
    "ais-dev-g3g74aaurwsbhiirpfr4n3-98532876696.asia-southeast1.run.app",
    "*.run.app",
  ],
  cacheComponents: true,
  partialPrefetching: true,
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
