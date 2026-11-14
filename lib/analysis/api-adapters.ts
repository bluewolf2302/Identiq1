import { z } from "zod";

import {
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  type AnalysisRequest,
  type EvidenceReference,
  type FindingSeverity,
  type ReviewFinding as BackendReviewFinding,
} from "../contracts";
import type {
  AnalysisRequestPayload,
  AnalysisResponsePayload,
  FindingCategory,
  ReviewFinding,
} from "../types";

const FrontendAnalysisRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    contentType: z.enum([
      "Campaign Copy",
      "Social Creative",
      "Product Sheet",
      "Press Release",
      "Landing Page",
    ]),
    guidelineCollection: z.string().trim().min(1),
    textContent: z.string().trim().min(1),
    submissionId: z.string().trim().min(1).optional(),
    assetName: z.string().trim().min(1).optional(),
    assetBase64: z.string().min(1).optional(),
    assetMimeType: z.string().trim().min(1).optional(),
    knowledgeSummary: z.array(z.string()).optional(),
  })
  .strict();

export class UnsupportedDemoBrandError extends Error {
  constructor(guidelineCollection: string) {
    super(
      `No configured demo brand mapping exists for guideline collection "${guidelineCollection}".`,
    );
    this.name = "UnsupportedDemoBrandError";
  }
}

export class InvalidFrontendAnalysisRequestError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    super("The analysis request is invalid.");
    this.name = "InvalidFrontendAnalysisRequestError";
    this.issues = issues;
  }
}

export class InvalidBackendAnalysisResponseError extends Error {
  constructor() {
    super("The analysis response failed contract validation.");
    this.name = "InvalidBackendAnalysisResponseError";
  }
}

const DEMO_BRAND_BY_GUIDELINE_COLLECTION: Readonly<Record<string, string>> = {
  "Teralune Brand Identity & AI Guidelines v1.0": "035a1c41-9870-4436-bec6-330142610118",
};

function createSubmissionId(): string {
  return globalThis.crypto?.randomUUID() ?? `submission-${Date.now()}`;
}

export function parseFrontendAnalysisRequest(
  input: unknown,
): AnalysisRequestPayload {
  const parsed = FrontendAnalysisRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidFrontendAnalysisRequestError(parsed.error.issues);
  }
  return parsed.data;
}

export function adaptFrontendRequest(
  input: unknown,
  options: { createSubmissionId?: () => string } = {},
): AnalysisRequest {
  const frontend = parseFrontendAnalysisRequest(input);
  const brandId =
    DEMO_BRAND_BY_GUIDELINE_COLLECTION[frontend.guidelineCollection];
  if (!brandId) {
    throw new UnsupportedDemoBrandError(frontend.guidelineCollection);
  }

  const backendRequest = {
    submissionId:
      frontend.submissionId ??
      (options.createSubmissionId ?? createSubmissionId)(),
    brandId,
    campaignName: frontend.title,
    contentText: frontend.textContent,
  };
  const parsed = AnalysisRequestSchema.safeParse(backendRequest);
  if (!parsed.success) {
    throw new InvalidFrontendAnalysisRequestError(parsed.error.issues);
  }
  return parsed.data;
}

function mapCategory(category: BackendReviewFinding["category"]): FindingCategory {
  switch (category) {
    case "FACT_VERIFICATION":
      return "Brand Claims";
    case "PROMOTIONAL_CLAIM":
      return "Legal & Usage";
    case "VISUAL_COMPLIANCE":
      return "Visual Identity";
    case "ACCESSIBILITY":
      return "Legal & Usage";
    case "TONE_AND_TERMINOLOGY":
      return "Tone & Voice";
  }
}

function mapSeverity(severity: FindingSeverity): ReviewFinding["severity"] {
  switch (severity) {
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
    case "INFO":
      return "low";
  }
}

function mapEvidenceStatus(
  status: BackendReviewFinding["status"],
): ReviewFinding["evidenceStatus"] {
  switch (status) {
    case "SUPPORTED":
      return "supported";
    case "CONFLICTING":
      return "conflicting";
    case "UNVERIFIED":
    case "NEEDS_HUMAN_REVIEW":
      return "unverified";
  }
}

function formatEvidenceReference(reference: EvidenceReference): string {
  const location = [
    reference.versionId ? `version ${reference.versionId}` : undefined,
    reference.pageNumber ? `page ${reference.pageNumber}` : undefined,
    reference.section ? `section ${reference.section}` : undefined,
  ]
    .filter((item): item is string => item !== undefined)
    .join(", ");
  return `${reference.sourceTitle} (${reference.sourceId}${
    location ? `; ${location}` : ""
  })`;
}

function mapFinding(
  finding: BackendReviewFinding,
  content: string,
): ReviewFinding {
  const affectedContent =
    finding.detectedValue ??
    (finding.location?.startOffset !== undefined &&
    finding.location.endOffset !== undefined
      ? content.slice(finding.location.startOffset, finding.location.endOffset)
      : "");
  const sourceReference = finding.evidenceReferences.length
    ? finding.evidenceReferences.map(formatEvidenceReference).join(" | ")
    : "No evidence reference available";

  return {
    id: finding.findingId,
    category: mapCategory(finding.category),
    title: finding.issue,
    description: finding.description,
    severity: mapSeverity(finding.severity),
    evidenceStatus: mapEvidenceStatus(finding.status),
    detectedValue: finding.detectedValue ?? "",
    expectedValue: finding.expectedValue ?? "",
    sourceReference,
    recommendation: finding.suggestedCorrection ?? "",
    affectedContent,
    resolved: false,
    comments: [],
    evidenceReferences: finding.evidenceReferences,
    sourceVersionIds: finding.evidenceReferences
      .map((reference) => reference.versionId)
      .filter((versionId): versionId is string => versionId !== undefined),
    location: finding.location,
  };
}

function calculateDisplayScore(findings: ReviewFinding[]): number {
  const penalty = findings.reduce((total, finding) => {
    if (finding.severity === "high") return total + 25;
    if (finding.severity === "medium") return total + 15;
    return total + 5;
  }, 0);
  return Math.max(0, 100 - penalty);
}

export function adaptBackendResponse(
  input: unknown,
  content: string,
): AnalysisResponsePayload {
  const parsed = AnalysisResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidBackendAnalysisResponseError();
  }
  const findings = parsed.data.findings.map((finding) =>
    mapFinding(finding, content),
  );
  const summary =
    parsed.data.analysisStatus === "PARTIAL"
      ? "Analysis completed with incomplete approved brand context."
      : findings.length === 0
        ? "No governance findings were identified."
        : `${findings.length} governance finding${findings.length === 1 ? "" : "s"} identified.`;

  return {
    submissionId: parsed.data.submissionId,
    analysisRunId: parsed.data.analysisRunId,
    analysisStatus: parsed.data.analysisStatus,
    fallbackUsed: parsed.data.fallbackUsed,
    complianceScore: calculateDisplayScore(findings),
    providerUsed: parsed.data.providerUsed,
    summary,
    findings,
  };
}
