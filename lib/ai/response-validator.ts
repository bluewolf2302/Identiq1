import { z } from "zod";

import {
  BrandContextSchema,
  ReviewFindingSchema,
  type BrandContext,
  type EvidenceReference,
  type ReviewFinding,
} from "../contracts";

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
    category: z.preprocess((val) => {
      if (typeof val !== "string") return "FACT_VERIFICATION";
      const upper = val.trim().toUpperCase();
      if (upper.includes("TONE") || upper.includes("TERM")) return "TONE_AND_TERMINOLOGY";
      if (upper.includes("CLAIM") || upper.includes("FACT") || upper.includes("BRAND")) return "FACT_VERIFICATION";
      if (upper.includes("PROMO") || upper.includes("LEGAL") || upper.includes("USAGE")) return "PROMOTIONAL_CLAIM";
      if (upper.includes("VISUAL") || upper.includes("LOGO") || upper.includes("COLOUR")) return "VISUAL_COMPLIANCE";
      if (upper.includes("ACCESS")) return "ACCESSIBILITY";
      return "FACT_VERIFICATION";
    }, z.enum([
      "TONE_AND_TERMINOLOGY",
      "FACT_VERIFICATION",
      "PROMOTIONAL_CLAIM",
      "VISUAL_COMPLIANCE",
      "ACCESSIBILITY",
    ])),
    severity: z.preprocess((val) => {
      if (typeof val !== "string") return "MEDIUM";
      const upper = val.trim().toUpperCase();
      if (["HIGH", "MEDIUM", "LOW", "INFO"].includes(upper)) return upper;
      if (upper === "CRITICAL" || upper === "SEVERE") return "HIGH";
      return "MEDIUM";
    }, z.enum(["HIGH", "MEDIUM", "LOW", "INFO"])),
    status: z.preprocess((val) => {
      if (typeof val !== "string") return "UNVERIFIED";
      const upper = val.trim().toUpperCase();
      if (["SUPPORTED", "CONFLICTING", "UNVERIFIED", "NEEDS_HUMAN_REVIEW"].includes(upper)) return upper;
      if (upper === "FALSE" || upper === "VIOLATION") return "CONFLICTING";
      if (upper === "TRUE" || upper === "PASS") return "SUPPORTED";
      return "UNVERIFIED";
    }, z.enum([
      "SUPPORTED",
      "CONFLICTING",
      "UNVERIFIED",
      "NEEDS_HUMAN_REVIEW",
    ])),
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

  const sourceIds = new Set(parsedContext.data.sourceIds);
  const sourceMetadata = parseSourceMetadata(parsedContext.data);
  const sourceValues = collectSourceEvidence(parsedContext.data);
  return parsed.data.findings.map((candidate, index) => {
    for (const evidence of candidate.evidenceReferences) {
      if (!sourceIds.has(evidence.sourceId)) {
        throw new AiEvidenceValidationError(
          `AI finding ${index} referenced an unknown source.`,
        );
      }
      const metadata = sourceMetadata.get(evidence.sourceId);
      if (metadata && metadata.versionId !== evidence.versionId) {
        throw new AiEvidenceValidationError(
          `AI finding ${index} referenced an invalid source version.`,
        );
      }
      if (metadata && metadata.sourceTitle !== evidence.sourceTitle) {
        throw new AiEvidenceValidationError(
          `AI finding ${index} referenced mismatched source metadata.`,
        );
      }
      if (
        evidence.excerpt &&
        !sourceValues
          .get(evidence.sourceId)
          ?.some((value) =>
            normalizeEvidenceText(value).includes(
              normalizeEvidenceText(evidence.excerpt!),
            ),
          )
      ) {
        throw new AiEvidenceValidationError(
          `AI finding ${index} supplied an unsupported evidence excerpt.`,
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
    return finding;
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

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function parseSourceMetadata(
  context: BrandContext,
): Map<string, { sourceTitle: string; versionId: string }> {
  const metadata = new Map<string, { sourceTitle: string; versionId: string }>();
  for (const label of context.sourceVersionInformation.split(/\s+\|\s+/)) {
    const match = label.match(/^(.+?)\s+\(([^;]+);\s*([^;)]+)/);
    if (match) {
      metadata.set(match[2].trim(), {
        sourceTitle: match[1].trim(),
        versionId: match[3].trim(),
      });
    }
  }
  return metadata;
}

function collectSourceEvidence(
  context: BrandContext,
): Map<string, string[]> {
  const evidence = new Map<string, string[]>();
  const sourceLabelPattern =
    /\[Source:\s*(.+?)\s+\(([^;()[\]]+);\s*([^;()[\]]+)/i;
  const values = [
    ...context.approvedGuidelines,
    ...context.approvedProductFacts,
    ...context.approvedPromotionalClaims,
    ...context.preferredTerminology,
    ...context.prohibitedTerminology,
    ...context.approvedColours,
    ...context.approvedVisualAssetReferences,
  ];

  for (const value of values) {
    const match = value.match(sourceLabelPattern);
    if (!match) continue;
    const existing = evidence.get(match[2].trim()) ?? [];
    existing.push(value);
    evidence.set(match[2].trim(), existing);
  }
  return evidence;
}
