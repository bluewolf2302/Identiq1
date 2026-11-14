import { z } from "zod";

export const PdfPageExtractionStatusSchema = z.enum([
  "TEXT_EXTRACTED",
  "NO_EXTRACTABLE_TEXT",
]);

export const PdfPageExtractionSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    status: PdfPageExtractionStatusSchema,
  })
  .strict();

export const PdfExtractionResultSchema = z
  .object({
    fileName: z.string().min(1).refine((value) => value.trim().length > 0),
    totalPageCount: z.number().int().positive(),
    status: PdfPageExtractionStatusSchema,
    pages: z.array(PdfPageExtractionSchema).min(1),
    notice: z.string().optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.pages.length !== result.totalPageCount) {
      context.addIssue({
        code: "custom",
        message: "Page count must match the extracted page list.",
        path: ["pages"],
      });
    }

    result.pages.forEach((page, index) => {
      if (page.pageNumber !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Extracted pages must have sequential 1-based page numbers.",
          path: ["pages", index, "pageNumber"],
        });
      }

      const expectedStatus = /\S/u.test(page.text)
        ? "TEXT_EXTRACTED"
        : "NO_EXTRACTABLE_TEXT";
      if (page.status !== expectedStatus) {
        context.addIssue({
          code: "custom",
          message: "Page status must match whether its text contains content.",
          path: ["pages", index, "status"],
        });
      }
    });

    const hasText = result.pages.some((page) => page.status === "TEXT_EXTRACTED");
    const expectedStatus = hasText ? "TEXT_EXTRACTED" : "NO_EXTRACTABLE_TEXT";
    if (result.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "Document status must match its page extraction results.",
        path: ["status"],
      });
    }

    if (!hasText && !result.notice) {
      context.addIssue({
        code: "custom",
        message: "A no-text result must include an explanatory notice.",
        path: ["notice"],
      });
    }
  });

export type PdfPageExtractionStatus = z.infer<
  typeof PdfPageExtractionStatusSchema
>;
export type PdfPageExtraction = z.infer<typeof PdfPageExtractionSchema>;
export type PdfExtractionResult = z.infer<typeof PdfExtractionResultSchema>;

export type PdfExtractionInput = {
  fileName: string;
  mimeType: string;
  data: Uint8Array | ArrayBuffer;
};

export type PdfExtractionErrorCode =
  | "INVALID_FILE_NAME"
  | "INVALID_FILE_TYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_PDF_SIGNATURE"
  | "ENCRYPTED_PDF"
  | "MALFORMED_PDF"
  | "PDF_PROCESSING_FAILED"
  | "PARSER_CLEANUP_FAILED";

export class GuidelinePdfExtractionError extends Error {
  readonly code: PdfExtractionErrorCode;
  readonly cause: unknown;

  constructor(
    code: PdfExtractionErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GuidelinePdfExtractionError";
    this.code = code;
    this.cause = cause;
  }
}
