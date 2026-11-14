import { z } from "zod";

import { BrandContextSchema } from "./brand";
import { BoundingBoxSchema, ReviewFindingSchema } from "./findings";

export const UploadedFileReferenceSchema = z
  .object({
    fileId: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    uri: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type UploadedFileReference = z.infer<
  typeof UploadedFileReferenceSchema
>;

export const CreativePayloadSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    fileName: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    base64Data: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type CreativePayload = z.infer<typeof CreativePayloadSchema>;

export const OcrBlockContractSchema = z
  .object({
    text: z.string().min(1),
    pageNumber: z.number().int().positive(),
    boundingBox: BoundingBoxSchema,
    confidence: z.number().min(0).max(1),
    rotation: z.number().optional(),
    source: z.enum(["ocr", "pdf_text_layer"]),
    uncertain: z.boolean().optional(),
    reviewStatus: z.enum(["candidate", "uncertain"]),
  })
  .strict();

export type OcrBlockContract = z.infer<typeof OcrBlockContractSchema>;

export const VisualPageSummarySchema = z
  .object({
    pageNumber: z.number().int().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    rotation: z.number(),
    imageWidth: z.number().int().nonnegative(),
    imageHeight: z.number().int().nonnegative(),
    status: z.enum(["ok", "failed"]),
    error: z.string().optional(),
    previewDataUrl: z.string().optional(),
  })
  .strict();

export type VisualPageSummary = z.infer<typeof VisualPageSummarySchema>;

export const VisualAnalysisSummarySchema = z
  .object({
    status: z.enum(["COMPLETED", "PARTIAL", "FAILED", "SKIPPED"]),
    assetId: z.string().min(1),
    fileName: z.string().min(1),
    format: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    processedPageCount: z.number().int().nonnegative(),
    extractedText: z.string(),
    visionProviderUsed: z.string().optional(),
    pages: z.array(VisualPageSummarySchema),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  })
  .strict();

export type VisualAnalysisSummary = z.infer<typeof VisualAnalysisSummarySchema>;

export const AnalysisRequestSchema = z
  .object({
    submissionId: z.string().min(1),
    brandId: z.string().min(1),
    campaignName: z.string().min(1),
    contentText: z.string().optional(),
    uploadedFileReferences: z.array(UploadedFileReferenceSchema).optional(),
    creativePayload: CreativePayloadSchema.optional(),
    contentPlatform: z.string().min(1).optional(),
    brandContext: BrandContextSchema.optional(),
  })
  .strict();

export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

export const AnalysisStatusSchema = z.enum([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisResponseSchema = z
  .object({
    submissionId: z.string().min(1),
    analysisRunId: z.string().min(1),
    analysisStatus: AnalysisStatusSchema,
    findings: z.array(ReviewFindingSchema),
    providerUsed: z.string().min(1),
    fallbackUsed: z.boolean(),
    analysisTimestamp: z.string().datetime({ offset: true }),
    ocrBlocks: z.array(OcrBlockContractSchema).optional(),
    visualSummary: VisualAnalysisSummarySchema.optional(),
  })
  .strict();

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
