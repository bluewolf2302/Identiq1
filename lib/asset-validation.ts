import type { PersistenceMode } from "./supabase/client";

export const MAX_ASSET_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_ASSET_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
] as const;

export const ALLOWED_ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export interface AssetFileValidationResult {
  valid: boolean;
  error?: string;
  format?: string;
}

export function formatAssetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateAssetUploadFile(file: {
  name: string;
  size: number;
  type: string;
}): AssetFileValidationResult {
  const name = file.name.trim();
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : "";
  const mime = (file.type || "").toLowerCase();

  const extAllowed = (ALLOWED_ASSET_EXTENSIONS as readonly string[]).includes(ext);
  const mimeAllowed =
    !mime || (ALLOWED_ASSET_MIME_TYPES as readonly string[]).includes(mime);

  if (!extAllowed || !mimeAllowed) {
    return {
      valid: false,
      error: `Unsupported file format "${ext || file.type || "unknown"}". Upload a PNG, JPG, WEBP, or SVG image.`,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: "The selected file is empty (0 bytes). Choose a valid image asset.",
    };
  }

  if (file.size > MAX_ASSET_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size (${formatAssetBytes(file.size)}) exceeds the 5.00 MB limit for browser asset library uploads.`,
    };
  }

  const format =
    ext.replace(".", "").toUpperCase() ||
    (mime === "image/svg+xml"
      ? "SVG"
      : mime.split("/")[1]?.toUpperCase() || "IMAGE");

  return {
    valid: true,
    format: format === "JPEG" ? "JPG" : format,
  };
}

export function validateAssetSubmission(params: {
  name: string;
  hasFileOrPreview: boolean;
  pendingFileError?: string;
}): { valid: boolean; error?: string; normalizedName?: string } {
  if (params.pendingFileError) {
    return { valid: false, error: params.pendingFileError };
  }
  const normalizedName = params.name.trim();
  if (normalizedName.length < 2) {
    return {
      valid: false,
      error: "Please enter an asset title (at least 2 characters).",
    };
  }
  if (!params.hasFileOrPreview) {
    return {
      valid: false,
      error: "Please select a PNG, JPG, WEBP, or SVG image file to upload.",
    };
  }
  return { valid: true, normalizedName };
}

export interface AssetPersistenceNotice {
  scope: "local_browser" | "session_only";
  label: string;
  description: string;
  addToastSuffix: string;
}

export function getAssetPersistenceNotice(
  persistenceMode: PersistenceMode,
): AssetPersistenceNotice {
  if (
    persistenceMode === "AUTHENTICATED_SUPABASE" ||
    persistenceMode === "SHARED_DEMO"
  ) {
    return {
      scope: "session_only",
      label: "Session Library (Not Cloud-Synced)",
      description:
        "Visual asset uploads are kept in your current browser session only. There is no cloud /api/assets upload endpoint yet—reloading the page resets to the seeded brand fixtures. Guideline PDFs and visual colour/typography rules are synced under Brand Knowledge Hub.",
      addToastSuffix: "for this browser session (not synced to cloud storage)",
    };
  }

  return {
    scope: "local_browser",
    label: "Saved Locally in Browser",
    description:
      "Uploaded assets are stored in this browser's local storage workspace and persist across page reloads on this device.",
    addToastSuffix: "to your local browser Asset Library",
  };
}
