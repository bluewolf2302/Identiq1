import { z } from "zod";

import {
  BrandContextSchema,
  ComplianceCategorySchema,
  FindingSeveritySchema,
  FindingStatusSchema,
  ReviewFindingSchema,
  type BrandContext,
  type EvidenceReference,
  type ReviewFinding,
} from "../contracts";
import {
  collectApprovedSourceRecords,
  isApprovedEvidenceReference,
} from "../governance/evidence-validation";
import { applyFindingReliabilityPolicy } from "../governance/finding-policy";

const optionalNonEmptyString = z.preprocess(
  (v) => (v === null || (typeof v === "string" && !v.trim()) ? undefined : v),
  z.string().trim().min(1).optional(),
);

const optionalPositiveInt = z.preprocess(
  (v) => (v === null ? undefined : v),
  z.number().int().positive().optional(),
);

const CandidateEvidenceSchema = z
  .object({
    sourceId: z.string().min(1),
    versionId: z.string().min(1),
    sourceTitle: z.string().min(1),
    sourceType: z.string().min(1),
    excerpt: optionalNonEmptyString,
    pageNumber: optionalPositiveInt,
    section: optionalNonEmptyString,
  })
  .strict();

const CandidateLocationSchema = z
  .object({
    startOffset: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.number().int().nonnegative().optional(),
    ),
    endOffset: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.number().int().nonnegative().optional(),
    ),
    quote: optionalNonEmptyString,
  })
  .strict()
  .refine(
    (location) =>
      location.endOffset === undefined ||
      location.startOffset === undefined ||
      location.endOffset >= location.startOffset,
    "endOffset must be greater than or equal to startOffset",
  );

export const AiFindingCandidateSchema = z
  .object({
    category: ComplianceCategorySchema,
    severity: FindingSeveritySchema,
    status: FindingStatusSchema,
    issue: z.string().trim().min(1),
    description: z.string().trim().min(1),
    detectedValue: optionalNonEmptyString,
    expectedValue: optionalNonEmptyString,
    explanation: z.string().trim().min(1),
    suggestedCorrection: optionalNonEmptyString,
    evidenceReferences: z.array(CandidateEvidenceSchema).min(1),
    location: z.preprocess(
      (v) => (v === null ? undefined : v),
      CandidateLocationSchema.optional(),
    ),
    confidence: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.number().min(0).max(1).optional(),
    ),
  })
  .strict();

export const AiCandidateResponseSchema = z
  .object({
    findings: z.array(AiFindingCandidateSchema),
  })
  .strict();

export type AiFindingCandidate = z.infer<typeof AiFindingCandidateSchema>;

export class AiCandidateValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super("AI response did not contain valid structured findings.");
    this.name = "AiCandidateValidationError";
    this.issues = issues;
  }
}

export class AiEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiEvidenceValidationError";
  }
}

export function parseAndValidateCandidates(
  value: unknown,
  context: BrandContext,
  content: string,
): ReviewFinding[] {
  const parsedContext = BrandContextSchema.safeParse(context);
  if (!parsedContext.success) {
    throw new AiEvidenceValidationError("Brand context is invalid.");
  }

  const parsed = AiCandidateResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiCandidateValidationError(parsed.error.issues);
  }

  const sourceRecords = collectApprovedSourceRecords(parsedContext.data);
  return parsed.data.findings.map((candidate, index) => {
    for (const evidence of candidate.evidenceReferences) {
      if (!isApprovedEvidenceReference(evidence, sourceRecords)) {
        throw new AiEvidenceValidationError(
          `AI finding ${index} referenced invalid or mismatched source evidence.`,
        );
      }
    }

    const location = candidate.location
      ? validateLocation(candidate.location, content)
      : undefined;
    const evidenceReferences: EvidenceReference[] = candidate.evidenceReferences;
    const finding = ReviewFindingSchema.parse({
      findingId: `ai-${index + 1}`,
      ...candidate,
      evidenceReferences,
      location,
      analysisProvider: "ai-semantic-analysis",
    });
    const evidenceSufficient =
      candidate.status !== "SUPPORTED" &&
      candidate.status !== "CONFLICTING"
        ? true
        : candidate.evidenceReferences.some((reference) => reference.excerpt);
    return applyFindingReliabilityPolicy(finding, evidenceSufficient);
  });
}

function validateLocation(
  location: AiFindingCandidate["location"],
  content: string,
) {
  if (!location) {
    return undefined;
  }
  if (
    location.startOffset !== undefined &&
    location.endOffset !== undefined &&
    location.startOffset >= 0 &&
    location.endOffset <= content.length &&
    location.startOffset <= location.endOffset &&
    (!location.quote ||
      content.slice(location.startOffset, location.endOffset) === location.quote)
  ) {
    return {
      startOffset: location.startOffset,
      endOffset: location.endOffset,
    };
  }
  if (
    location.quote &&
    location.startOffset === undefined &&
    location.endOffset === undefined
  ) {
    const idx = content.indexOf(location.quote);
    const lastIdx = content.lastIndexOf(location.quote);
    if (idx !== -1 && idx === lastIdx) {
      return {
        startOffset: idx,
        endOffset: idx + location.quote.length,
      };
    }

  }
  return undefined;
}
