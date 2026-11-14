import {
  getDocument,
  InvalidPDFException,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  GuidelinePdfExtractionError,
  PdfExtractionResultSchema,
  type PdfExtractionInput,
  type PdfExtractionResult,
  type PdfPageExtraction,
} from "./types";

export const MAX_GUIDELINE_PDF_SIZE_BYTES = 20 * 1024 * 1024;
const PDF_HEADER_SEARCH_BYTES = 1024;
const NO_TEXT_NOTICE =
  "No extractable text was found. This PDF may be scanned or image-only; OCR was not performed.";

export async function extractGuidelinePdfText(
  input: PdfExtractionInput,
): Promise<PdfExtractionResult> {
  const bytes = getBytes(input.data);
  validatePdfInput(input, bytes);

  const loadingTask = getDocument({
    data: bytes,
    stopAtErrors: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  let extractionError: GuidelinePdfExtractionError | undefined;

  try {
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new GuidelinePdfExtractionError(
        "MALFORMED_PDF",
        "The PDF does not contain any readable pages.",
      );
    }

    const pages: PdfPageExtraction[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({
        disableNormalization: true,
      });

      let text = "";
      for (const item of textContent.items) {
        if ("str" in item && typeof item.str === "string") {
          text += item.str;
          if (item.hasEOL) {
            text += "\n";
          }
        }
      }

      pages.push({
        pageNumber,
        text,
        status: /\S/u.test(text) ? "TEXT_EXTRACTED" : "NO_EXTRACTABLE_TEXT",
      });
    }

    const hasText = pages.some((page) => page.status === "TEXT_EXTRACTED");
    return PdfExtractionResultSchema.parse({
      fileName: input.fileName,
      totalPageCount: document.numPages,
      status: hasText ? "TEXT_EXTRACTED" : "NO_EXTRACTABLE_TEXT",
      pages,
      ...(!hasText ? { notice: NO_TEXT_NOTICE } : {}),
    });
  } catch (error) {
    const mappedError = mapPdfProcessingError(error);
    extractionError = mappedError;
    throw mappedError;
  } finally {
    try {
      await loadingTask.destroy();
    } catch (error) {
      if (!extractionError) {
        throw new GuidelinePdfExtractionError(
          "PARSER_CLEANUP_FAILED",
          "The PDF parser could not release its resources.",
          error,
        );
      }
    }
  }
}

function getBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array
    ? data.slice()
    : new Uint8Array(data).slice();
}

function validatePdfInput(
  input: PdfExtractionInput,
  bytes: Uint8Array,
): void {
  if (!input.fileName.trim()) {
    throw new GuidelinePdfExtractionError(
      "INVALID_FILE_NAME",
      "A PDF file name is required.",
    );
  }
  if (input.mimeType.trim().toLowerCase().split(";")[0] !== "application/pdf") {
    throw new GuidelinePdfExtractionError(
      "INVALID_FILE_TYPE",
      "The uploaded file must have the application/pdf media type.",
    );
  }
  if (bytes.byteLength === 0) {
    throw new GuidelinePdfExtractionError(
      "EMPTY_FILE",
      "The uploaded PDF file is empty.",
    );
  }
  if (bytes.byteLength > MAX_GUIDELINE_PDF_SIZE_BYTES) {
    throw new GuidelinePdfExtractionError(
      "FILE_TOO_LARGE",
      `The PDF exceeds the ${MAX_GUIDELINE_PDF_SIZE_BYTES}-byte size limit.`,
    );
  }

  const header = new TextDecoder("ascii").decode(
    bytes.subarray(0, PDF_HEADER_SEARCH_BYTES),
  );
  if (!/%PDF-\d\.\d/u.test(header)) {
    throw new GuidelinePdfExtractionError(
      "INVALID_PDF_SIGNATURE",
      "The file does not contain a valid PDF header.",
    );
  }
}

function mapPdfProcessingError(error: unknown): GuidelinePdfExtractionError {
  if (error instanceof GuidelinePdfExtractionError) {
    return error;
  }
  if (
    (error instanceof Error && error.name === "PasswordException")
  ) {
    return new GuidelinePdfExtractionError(
      "ENCRYPTED_PDF",
      "The PDF is encrypted and cannot be read without a password.",
      error,
    );
  }
  if (
    error instanceof InvalidPDFException ||
    (error instanceof Error &&
      /^(?:InvalidPDFException|MissingPDFException|FormatError|XRefParseException)$/u.test(
        error.name,
      ))
  ) {
    return new GuidelinePdfExtractionError(
      "MALFORMED_PDF",
      "The PDF is corrupt or malformed and could not be parsed.",
      error,
    );
  }
  return new GuidelinePdfExtractionError(
    "PDF_PROCESSING_FAILED",
    "The PDF could not be processed.",
    error,
  );
}
