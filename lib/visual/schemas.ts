import { z } from "zod";
import { BoundingBoxSchema } from "../contracts";

export const OcrBlockSchema = z
  .object({
    text: z.string().min(1),
    pageNumber: z.number().int().positive(),
    boundingBox: BoundingBoxSchema,
    confidence: z.number().min(0).max(1),
    rotation: z.number().optional(),
    source: z.enum(["ocr", "pdf_text_layer"]),
    uncertain: z.boolean(),
    reviewStatus: z.enum(["candidate", "uncertain"]),
  })
  .strict();

export const VisualFindingSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1).nullable(),
    category: z.enum([
      "logo",
      "colour",
      "typography",
      "layout",
      "visual_consistency",
    ]),
    title: z.string().min(1),
    explanation: z.string().min(1),
    expectedValue: z.string().min(1),
    observedValue: z.string().min(1),
    sourceReference: z
      .object({
        sourceId: z.string().min(1).nullable(),
        sourceVersion: z.string().min(1).nullable(),
        sourceTitle: z.string().min(1).nullable().optional(),
        pageNumber: z.number().int().positive().nullable(),
        excerpt: z.string().min(1).nullable(),
      })
      .strict(),
    creativeEvidence: z
      .object({
        assetId: z.string().min(1),
        pageNumber: z.number().int().positive(),
        boundingBox: BoundingBoxSchema.nullable(),
        description: z.string().min(1),
      })
      .strict(),
    confidence: z.number().min(0).max(1),
    reviewStatus: z.enum(["candidate", "uncertain", "needs_human_review"]),
    severity: z.enum(["HIGH", "MEDIUM", "LOW", "INFO"]),
    detector: z.enum(["ocr", "deterministic", "image_matching", "gemini_vision"]),
    classification: z
      .enum(["objective_mismatch", "possible_mismatch", "design_recommendation"])
      .optional(),
    suggestedCorrection: z.string().min(1).optional(),
  })
  .strict();

export const GeminiVisionCandidateItemSchema = z
  .object({
    ruleId: z.string().trim().min(1).nullable().optional(),
    category: z.enum([
      "logo",
      "colour",
      "typography",
      "layout",
      "visual_consistency",
    ]),
    title: z.string().trim().min(1),
    explanation: z.string().trim().min(1),
    expectedValue: z.string().trim().min(1),
    observedValue: z.string().trim().min(1),
    sourceId: z.string().trim().min(1).nullable().optional(),
    sourceVersion: z.string().trim().min(1).nullable().optional(),
    guidelinePageNumber: z.number().int().positive().nullable().optional(),
    excerpt: z.string().trim().min(1).nullable().optional(),
    boundingBox: BoundingBoxSchema.nullable().optional(),
    evidenceDescription: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    reviewStatus: z.enum(["candidate", "uncertain", "needs_human_review"]),
    severity: z.enum(["HIGH", "MEDIUM", "LOW", "INFO"]),
    suggestedCorrection: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const GeminiVisionResponseSchema = z
  .object({
    findings: z.array(GeminiVisionCandidateItemSchema),
  })
  .strict();

export type GeminiVisionCandidateItem = z.infer<typeof GeminiVisionCandidateItemSchema>;
export type GeminiVisionResponse = z.infer<typeof GeminiVisionResponseSchema>;
