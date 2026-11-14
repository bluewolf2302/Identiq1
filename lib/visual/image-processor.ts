import sharp from "sharp";
import type { VisualPipelineConfig } from "./config";
import type { ProcessedPage, ValidatedCreativeFile } from "./types";

function exifOrientationToDegrees(orientation?: number): number {
  switch (orientation) {
    case 3:
    case 4:
      return 180;
    case 5:
    case 6:
      return 90;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

export async function processImageCreative(
  file: ValidatedCreativeFile,
  config: VisualPipelineConfig,
): Promise<ProcessedPage[]> {
  const warnings: string[] = [];

  try {
    const meta = await sharp(file.buffer).metadata();
    const originalWidth = meta.width ?? 0;
    const originalHeight = meta.height ?? 0;
    const rotation = exifOrientationToDegrees(meta.orientation);

    if (rotation !== 0) {
      warnings.push(
        `Image contains EXIF orientation (${rotation}°); auto-rotated upright before OCR and visual checks.`,
      );
    }

    // Auto-orient upright and bound max dimension for predictable processing
    let pipeline = sharp(file.buffer).rotate();
    const uprightMeta = await pipeline.clone().metadata();
    const uprightWidth = uprightMeta.width ?? originalWidth;
    const uprightHeight = uprightMeta.height ?? originalHeight;

    if (
      uprightWidth < config.minReadableWidthPx ||
      uprightHeight < config.minReadableHeightPx
    ) {
      warnings.push(
        `Low-resolution creative (${uprightWidth}×${uprightHeight} px). Visual and OCR findings may be uncertain and require human review.`,
      );
    }

    if (
      uprightWidth > config.maxRenderedDimensionPx ||
      uprightHeight > config.maxRenderedDimensionPx
    ) {
      pipeline = pipeline.resize({
        width: config.maxRenderedDimensionPx,
        height: config.maxRenderedDimensionPx,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const { data: pngBuffer, info } = await pipeline
      .png()
      .toBuffer({ resolveWithObject: true });

    const previewBuffer = await sharp(pngBuffer)
      .resize({
        width: config.previewMaxDimensionPx,
        height: config.previewMaxDimensionPx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 8 })
      .toBuffer();

    return [
      {
        pageNumber: 1,
        width: uprightWidth,
        height: uprightHeight,
        rotation,
        imageWidth: info.width,
        imageHeight: info.height,
        pngBuffer,
        previewDataUrl: `data:image/png;base64,${previewBuffer.toString("base64")}`,
        embeddedText: "",
        embeddedSpans: [],
        status: "ok",
        warnings,
        originalAssetId: file.assetId,
      },
    ];
  } catch (error) {
    return [
      {
        pageNumber: 1,
        width: 0,
        height: 0,
        rotation: 0,
        imageWidth: 0,
        imageHeight: 0,
        pngBuffer: Buffer.alloc(0),
        embeddedText: "",
        embeddedSpans: [],
        status: "failed",
        error:
          error instanceof Error
            ? `Image processing failed: ${error.message}`
            : "Image processing failed.",
        warnings,
        originalAssetId: file.assetId,
      },
    ];
  }
}
