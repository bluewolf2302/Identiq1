import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  getVisualPipelineConfig,
  SUPPORTED_EXTENSIONS,
  type VisualPipelineConfig,
} from "./config";
import {
  VisualValidationError,
  type CreativeFileInput,
  type CreativeFormat,
  type ValidatedCreativeFile,
} from "./types";

function detectMagicSignature(
  buffer: Buffer,
): { format: CreativeFormat; mimeType: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: "jpg", mimeType: "image/jpeg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: "png", mimeType: "image/png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { format: "webp", mimeType: "image/webp" };
  }
  const head = buffer.subarray(0, Math.min(1024, buffer.length)).toString("latin1");
  if (head.includes("%PDF-")) {
    return { format: "pdf", mimeType: "application/pdf" };
  }
  return null;
}

function normalizeDeclaredExtension(fileName: string): string {
  return path.extname(fileName.trim()).toLowerCase();
}

function expectedMimeForExtension(ext: string): string | null {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    default:
      return null;
  }
}

export async function validateCreativeFile(
  input: CreativeFileInput,
  configOverrides: Partial<VisualPipelineConfig> = {},
): Promise<ValidatedCreativeFile> {
  const config = getVisualPipelineConfig(configOverrides);
  const ext = normalizeDeclaredExtension(input.fileName);

  if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    throw new VisualValidationError(
      "UNSUPPORTED_FORMAT",
      `Unsupported file format "${ext || "unknown"}". Supported formats are .jpg, .jpeg, .png, .webp, and .pdf.`,
    );
  }

  let buffer: Buffer;
  if (input.buffer) {
    buffer = input.buffer;
  } else if (input.base64Data) {
    const cleaned = input.base64Data.replace(/^data:[^;]+;base64,/, "").trim();
    buffer = Buffer.from(cleaned, "base64");
  } else {
    throw new VisualValidationError("EMPTY_FILE", "The uploaded creative file is empty.");
  }

  if (buffer.length === 0) {
    throw new VisualValidationError("EMPTY_FILE", "The uploaded creative file is empty (0 bytes).");
  }

  if (buffer.length > config.maxFileSizeBytes) {
    const maxMb = (config.maxFileSizeBytes / (1024 * 1024)).toFixed(1);
    const actualMb = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new VisualValidationError(
      "OVERSIZED_FILE",
      `Creative file size (${actualMb} MB) exceeds the configured limit of ${maxMb} MB.`,
    );
  }

  const signature = detectMagicSignature(buffer);
  const expectedMime = expectedMimeForExtension(ext);

  if (!signature) {
    if (ext === ".pdf") {
      throw new VisualValidationError(
        "CORRUPT_PDF",
        "The uploaded PDF does not contain a valid PDF header signature.",
      );
    }
    throw new VisualValidationError(
      "CORRUPT_IMAGE",
      `The uploaded "${ext}" file does not match a valid image signature or is corrupted.`,
    );
  }

  if (expectedMime && signature.mimeType !== expectedMime) {
    throw new VisualValidationError(
      "MIME_SIGNATURE_MISMATCH",
      `File extension "${ext}" does not match the detected file content (${signature.mimeType}).`,
    );
  }

  if (
    input.declaredMimeType &&
    input.declaredMimeType !== "application/octet-stream" &&
    input.declaredMimeType.toLowerCase() !== signature.mimeType
  ) {
    throw new VisualValidationError(
      "MIME_SIGNATURE_MISMATCH",
      `Declared MIME type "${input.declaredMimeType}" does not match actual content (${signature.mimeType}).`,
    );
  }

  const resolvedFormat: CreativeFormat =
    ext === ".jpeg" && signature.format === "jpg" ? "jpeg" : signature.format;

  if (signature.format === "pdf") {
    let pageCount = 0;
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: false });
      pageCount = pdfDoc.getPageCount();
    } catch (error) {
      if (error instanceof VisualValidationError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (/encrypt/i.test(msg)) {
        throw new VisualValidationError(
          "ENCRYPTED_PDF",
          "The uploaded PDF is encrypted or password-protected and cannot be processed.",
        );
      }
      throw new VisualValidationError(
        "CORRUPT_PDF",
        "The uploaded PDF could not be parsed and appears corrupted.",
      );
    }

    if (pageCount <= 0) {
      throw new VisualValidationError(
        "EMPTY_PDF",
        "The uploaded PDF contains 0 pages.",
      );
    }

    return {
      assetId: input.assetId,
      fileName: input.fileName,
      format: resolvedFormat,
      detectedMimeType: signature.mimeType,
      sizeBytes: buffer.length,
      buffer,
      pdfPageCount: pageCount,
    };
  }

  // Deep image decode check via sharp to detect truncated or corrupt images
  try {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new VisualValidationError(
        "CORRUPT_IMAGE",
        "The uploaded image has invalid or zero dimensions.",
      );
    }
    // Force full pixel decode on a lightweight pipeline to catch truncated streams
    await sharp(buffer, { failOn: "error" })
      .resize({ width: Math.min(metadata.width, 64), withoutEnlargement: true })
      .raw()
      .toBuffer();
  } catch (error) {
    if (error instanceof VisualValidationError) {
      throw error;
    }
    throw new VisualValidationError(
      "CORRUPT_IMAGE",
      "The uploaded image could not be decoded and appears corrupted or truncated.",
    );
  }

  return {
    assetId: input.assetId,
    fileName: input.fileName,
    format: resolvedFormat,
    detectedMimeType: signature.mimeType,
    sizeBytes: buffer.length,
    buffer,
  };
}
