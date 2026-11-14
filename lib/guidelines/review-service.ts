import { z } from "zod";
import {
  GuidelineDocumentRecordSchema,
  type GuidelineDocumentRecord,
  type GuidelineReviewStatus,
} from "./records";
import {
  PdfExtractionResultSchema,
  type PdfExtractionResult,
} from "./types";

export type GuidelineRuleReviewUpdate = {
  reviewedText?: string;
  reviewStatus?: GuidelineReviewStatus;
};

export interface GuidelineReviewService {
  extractPdf(file: File): Promise<PdfExtractionResult>;
  listDocuments(): Promise<GuidelineDocumentRecord[]>;
  createDraft(
    document: GuidelineDocumentRecord,
  ): Promise<GuidelineDocumentRecord>;
  saveDraft(document: GuidelineDocumentRecord): Promise<GuidelineDocumentRecord>;
  updateRule(
    documentId: string,
    versionId: string,
    ruleId: string,
    update: GuidelineRuleReviewUpdate,
  ): Promise<GuidelineDocumentRecord>;
}

export type GuidelinePdfExtractor = (
  file: File,
) => Promise<PdfExtractionResult>;

export type GuidelineReviewServiceErrorCode =
  | "EXTRACTION_FAILED"
  | "DUPLICATE_DRAFT"
  | "DRAFT_NOT_FOUND"
  | "RULE_NOT_FOUND"
  | "INVALID_UPDATE";

export class GuidelineReviewServiceError extends Error {
  readonly code: GuidelineReviewServiceErrorCode | string;

  constructor(code: GuidelineReviewServiceErrorCode | string, message: string) {
    super(message);
    this.name = "GuidelineReviewServiceError";
    this.code = code;
  }
}

const ExtractionResponseSchema = z
  .object({
    extraction: PdfExtractionResultSchema,
  })
  .strict();

const ExtractionErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

async function extractThroughTemporaryRoute(
  file: File,
): Promise<PdfExtractionResult> {
  const formData = new FormData();
  formData.set("file", file);

  let response: Response;
  try {
    response = await fetch("/api/guideline-review/extract", {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw new GuidelineReviewServiceError(
      "EXTRACTION_FAILED",
      error instanceof Error
        ? `PDF extraction request failed: ${error.message}`
        : "PDF extraction request failed.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GuidelineReviewServiceError(
      "EXTRACTION_FAILED",
      "The PDF extraction route returned an invalid response.",
    );
  }

  if (!response.ok) {
    const errorResponse = ExtractionErrorResponseSchema.safeParse(body);
    if (errorResponse.success) {
      throw new GuidelineReviewServiceError(
        errorResponse.data.error.code,
        errorResponse.data.error.message,
      );
    }
    throw new GuidelineReviewServiceError(
      "EXTRACTION_FAILED",
      "The PDF extraction request failed.",
    );
  }

  const extractionResponse = ExtractionResponseSchema.safeParse(body);
  if (!extractionResponse.success) {
    throw new GuidelineReviewServiceError(
      "EXTRACTION_FAILED",
      "The PDF extraction route returned invalid extraction data.",
    );
  }
  return extractionResponse.data.extraction;
}

function documentKey(documentId: string, versionId: string): string {
  return JSON.stringify([documentId, versionId]);
}

export function createInMemoryGuidelineReviewService(
  extractPdf: GuidelinePdfExtractor = extractThroughTemporaryRoute,
): GuidelineReviewService {
  const documents = new Map<string, GuidelineDocumentRecord>();

  return {
    extractPdf,

    async listDocuments() {
      return [...documents.values()].map((document) =>
        GuidelineDocumentRecordSchema.parse(document),
      );
    },

    async createDraft(document) {
      const parsed = GuidelineDocumentRecordSchema.parse(document);
      const key = documentKey(parsed.documentId, parsed.versionId);
      if (documents.has(key)) {
        throw new GuidelineReviewServiceError(
          "DUPLICATE_DRAFT",
          "A draft already exists for this document and version.",
        );
      }
      documents.set(key, parsed);
      return GuidelineDocumentRecordSchema.parse(parsed);
    },

    async saveDraft(document) {
      const parsed = GuidelineDocumentRecordSchema.parse(document);
      const key = documentKey(parsed.documentId, parsed.versionId);
      if (!documents.has(key)) {
        throw new GuidelineReviewServiceError(
          "DRAFT_NOT_FOUND",
          "The in-memory guideline draft was not found.",
        );
      }
      documents.set(key, parsed);
      return GuidelineDocumentRecordSchema.parse(parsed);
    },

    async updateRule(documentId, versionId, ruleId, update) {
      if (
        update.reviewedText === undefined &&
        update.reviewStatus === undefined
      ) {
        throw new GuidelineReviewServiceError(
          "INVALID_UPDATE",
          "At least one rule review field must be updated.",
        );
      }

      const key = documentKey(documentId, versionId);
      const current = documents.get(key);
      if (!current) {
        throw new GuidelineReviewServiceError(
          "DRAFT_NOT_FOUND",
          "The in-memory guideline draft was not found.",
        );
      }

      let foundRule = false;
      const rules = current.rules.map((rule) => {
        if (rule.ruleId !== ruleId) return rule;
        foundRule = true;
        return {
          ...rule,
          ...(update.reviewedText === undefined
            ? {}
            : { reviewedText: update.reviewedText }),
          ...(update.reviewStatus === undefined
            ? {}
            : { reviewStatus: update.reviewStatus }),
        };
      });

      if (!foundRule) {
        throw new GuidelineReviewServiceError(
          "RULE_NOT_FOUND",
          "The guideline rule was not found.",
        );
      }

      const updated = GuidelineDocumentRecordSchema.parse({
        ...current,
        rules,
      });
      documents.set(key, updated);
      return GuidelineDocumentRecordSchema.parse(updated);
    },
  };
}

export const guidelineReviewService =
  createInMemoryGuidelineReviewService();
