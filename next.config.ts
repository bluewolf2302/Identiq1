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

  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/@tesseract.js-data/eng/**/*",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],

    "/api/guideline-review/extract": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],

    "/api/guidelines/documents": [
      "./node_modules/@tesseract.js-data/eng/**/*",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],
  },
};

export default nextConfig;