import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  validateCreativeFile,
  VisualValidationError,
} from "../../lib/visual";

async function makePng(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 244, g: 248, b: 247 },
    },
  })
    .png()
    .toBuffer();
}

async function makeJpg(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 22, g: 58, b: 82 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function makeWebp(width = 400, height = 300): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 35, g: 154, b: 139 },
    },
  })
    .webp()
    .toBuffer();
}

async function makePdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([400, 500]);
  }
  return Buffer.from(await doc.save());
}

test("validates valid jpg, jpeg, png, webp, and pdf files", async () => {
  const png = await makePng();
  const jpg = await makeJpg();
  const webp = await makeWebp();
  const pdf = await makePdf(1);

  const vPng = await validateCreativeFile({
    assetId: "a1",
    fileName: "creative.png",
    declaredMimeType: "image/png",
    buffer: png,
  });
  assert.equal(vPng.format, "png");
  assert.equal(vPng.detectedMimeType, "image/png");

  const vJpg = await validateCreativeFile({
    assetId: "a2",
    fileName: "creative.jpg",
    declaredMimeType: "image/jpeg",
    buffer: jpg,
  });
  assert.equal(vJpg.format, "jpg");

  const vJpeg = await validateCreativeFile({
    assetId: "a3",
    fileName: "creative.JPEG",
    declaredMimeType: "image/jpeg",
    buffer: jpg,
  });
  assert.equal(vJpeg.format, "jpeg");

  const vWebp = await validateCreativeFile({
    assetId: "a4",
    fileName: "creative.webp",
    declaredMimeType: "image/webp",
    buffer: webp,
  });
  assert.equal(vWebp.format, "webp");

  const vPdf = await validateCreativeFile({
    assetId: "a5",
    fileName: "creative.pdf",
    declaredMimeType: "application/pdf",
    buffer: pdf,
  });
  assert.equal(vPdf.format, "pdf");
  assert.equal(vPdf.pdfPageCount, 1);
});

test("rejects unsupported file extensions", async () => {
  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "bad-ext",
        fileName: "banner.svg",
        declaredMimeType: "image/svg+xml",
        buffer: Buffer.from("<svg></svg>"),
      }),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "UNSUPPORTED_FORMAT",
  );
});

test("rejects empty 0-byte files", async () => {
  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "empty",
        fileName: "empty.png",
        declaredMimeType: "image/png",
        buffer: Buffer.alloc(0),
      }),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "EMPTY_FILE",
  );
});

test("rejects oversized files beyond configured limit", async () => {
  const png = await makePng(600, 600);
  await assert.rejects(
    () =>
      validateCreativeFile(
        {
          assetId: "huge",
          fileName: "huge.png",
          declaredMimeType: "image/png",
          buffer: png,
        },
        { maxFileSizeBytes: Math.max(10, png.length - 5) },
      ),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "OVERSIZED_FILE",
  );
});

test("rejects MIME/signature spoofing when a PNG is renamed to .jpg or declared with wrong MIME", async () => {
  const png = await makePng();

  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "spoof-ext",
        fileName: "spoofed.jpg",
        declaredMimeType: "image/jpeg",
        buffer: png,
      }),
    (err: unknown) =>
      err instanceof VisualValidationError &&
      err.code === "MIME_SIGNATURE_MISMATCH",
  );

  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "spoof-mime",
        fileName: "real.png",
        declaredMimeType: "application/pdf",
        buffer: png,
      }),
    (err: unknown) =>
      err instanceof VisualValidationError &&
      err.code === "MIME_SIGNATURE_MISMATCH",
  );
});

test("rejects corrupt images and truncated PNG streams", async () => {
  const validPng = await makePng(400, 300);
  const truncatedPng = validPng.subarray(0, Math.floor(validPng.length / 2));

  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "corrupt-img",
        fileName: "corrupt.png",
        declaredMimeType: "image/png",
        buffer: Buffer.from("not-an-image-at-all"),
      }),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "CORRUPT_IMAGE",
  );

  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "trunc-img",
        fileName: "truncated.png",
        declaredMimeType: "image/png",
        buffer: truncatedPng,
      }),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "CORRUPT_IMAGE",
  );
});

test("rejects corrupt PDFs and encrypted PDFs", async () => {
  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "corrupt-pdf",
        fileName: "corrupt.pdf",
        declaredMimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\ncorrupted garbage bytes"),
      }),
    (err: unknown) =>
      err instanceof VisualValidationError && err.code === "CORRUPT_PDF",
  );

  const encryptedLikePdf = Buffer.from(
    "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Encrypt >> endobj\n",
  );
  await assert.rejects(
    () =>
      validateCreativeFile({
        assetId: "enc-pdf",
        fileName: "locked.pdf",
        declaredMimeType: "application/pdf",
        buffer: encryptedLikePdf,
      }),
    (err: unknown) =>
      err instanceof VisualValidationError &&
      (err.code === "ENCRYPTED_PDF" || err.code === "CORRUPT_PDF"),
  );
});
