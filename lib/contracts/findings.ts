import { z } from "zod";

export const ComplianceCategorySchema = z.enum([
  "TONE_AND_TERMINOLOGY",
  "FACT_VERIFICATION",
  "PROMOTIONAL_CLAIM",
  "VISUAL_COMPLIANCE",
  "ACCESSIBILITY",
]);

export type ComplianceCategory = z.infer<typeof ComplianceCategorySchema>;

export const FindingSeveritySchema = z.enum(["HIGH", "MEDIUM", "LOW", "INFO"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingStatusSchema = z.enum([
  "SUPPORTED",
  "CONFLICTING",
  "UNVERIFIED",
  "NEEDS_HUMAN_REVIEW",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const EvidenceReferenceSchema = z
  .object({
    sourceId: z.string().min(1),
    sourceType: z.string().min(1),
    sourceTitle: z.string().min(1),
    excerpt: z.string().min(1).optional(),
    pageNumber: z.number().int().positive().optional(),
    section: z.string().min(1).optional(),
    versionId: z.string().min(1).optional(),
  })
  .strict();

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const BoundingBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .strict();

export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const FindingLocationSchema = z
  .object({
    field: z.string().min(1).optional(),
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    pageNumber: z.number().int().positive().optional(),
    assetReference: z.string().min(1).optional(),
    boundingBox: BoundingBoxSchema.optional(),
  })
  .strict()
  .refine(
    (location) =>
      location.endOffset === undefined ||
      location.startOffset === undefined ||
      location.endOffset >= location.startOffset,
    {
      message: "endOffset must be greater than or equal to startOffset",
      path: ["endOffset"],
    },
  );

export type FindingLocation = z.infer<typeof FindingLocationSchema>;

export const FindingDetectorSchema = z.enum([
  "ocr",
  "deterministic",
  "image_matching",
  "gemini_vision",
  "openrouter_vision",
  "ai_semantic",
]);

export type FindingDetector = z.infer<typeof FindingDetectorSchema>;

export const ReviewFindingSchema = z
  .object({
    findingId: z.string().min(1),
    ruleId: z.string().min(1).nullable().optional(),
    category: ComplianceCategorySchema,
    severity: FindingSeveritySchema,
    status: FindingStatusSchema,
    issue: z.string().min(1),
    description: z.string().min(1),
    detectedValue: z.string().min(1).optional(),
    expectedValue: z.string().min(1).optional(),
    explanation: z.string().min(1),
    evidenceReferences: z.array(EvidenceReferenceSchema),
    suggestedCorrection: z.string().min(1).optional(),
    location: FindingLocationSchema.optional(),
    analysisProvider: z.string().min(1),
    detector: FindingDetectorSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
