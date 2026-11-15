import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: {
    position: "bottom-right",
  },
  allowedDevOrigins: [
    "ais-dev-g3g74aaurwsbhiirpfr4n3-98532876696.asia-southeast1.run.app",
    "*.run.app",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: [
    "sharp",
    "tesseract.js",
    "pdfjs-dist",
    "@napi-rs/canvas",
  ],
};

export default nextConfig;