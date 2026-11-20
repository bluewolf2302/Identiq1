import { z } from "zod";
import type { AnalysisResponse, ReviewFinding } from "../contracts";
import {
  AnalysisStatusSchema,
  ReviewFindingSchema,
} from "../contracts";

export type FindingComparisonStatus =
  | "ADDED"
  | "REMOVED"
  | "CHANGED"
  | "UNCHANGED";

export interface FindingComparison {
  findingId: string;
  status: FindingComparisonStatus;
  previous?: ReviewFinding;
  current?: ReviewFinding;
  changedFields: string[];
}

export interface AnalysisComparison {
  previousRunId: string;
  currentRunId: string;
  previousStatus: AnalysisResponse["analysisStatus"];
  currentStatus: AnalysisResponse["analysisStatus"];
  findings: FindingComparison[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

export const AnalysisComparisonSchema = z
  .object({
    previousRunId: z.string().trim().min(1).max(200),
    currentRunId: z.string().trim().min(1).max(200),
    previousStatus: AnalysisStatusSchema,
    currentStatus: AnalysisStatusSchema,
    findings: z.array(
      z
        .object({
          findingId: z.string().trim().min(1).max(200),
          status: z.enum(["ADDED", "REMOVED", "CHANGED", "UNCHANGED"]),
          previous: ReviewFindingSchema.optional(),
          current: ReviewFindingSchema.optional(),
          changedFields: z.array(z.string().trim().min(1).max(100)),
        })
        .strict(),
    ),
    summary: z
      .object({
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (comparison) => {
      const counts = {
        ADDED: comparison.summary.added,
        REMOVED: comparison.summary.removed,
        CHANGED: comparison.summary.changed,
        UNCHANGED: comparison.summary.unchanged,
      };
      return (Object.keys(counts) as Array<keyof typeof counts>).every(
        (status) =>
          counts[status] ===
          comparison.findings.filter((finding) => finding.status === status).length,
      );
    },
    "Comparison summary must match the finding statuses.",
  );

export interface ReviewFindingComparisonPayload {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  evidenceStatus: string;
  detectedValue: string;
  expectedValue: string;
  sourceReference: string;
  ruleId?: string | null;
  location?: { pageNumber?: number };
  confidence?: number;
}

export function compareReviewFindingPayloads(
  previousRunId: string,
  currentRunId: string,
  previousStatus: AnalysisResponse["analysisStatus"],
  currentStatus: AnalysisResponse["analysisStatus"],
  previousFindings: ReviewFindingComparisonPayload[],
  currentFindings: ReviewFindingComparisonPayload[],
): AnalysisComparison {
  const keyFor = (finding: ReviewFindingComparisonPayload) =>
    finding.ruleId
      ? `${finding.category}:${finding.ruleId}`
      : finding.location?.pageNumber
        ? `${finding.category}:page-${finding.location.pageNumber}:${finding.title}`
        : `${finding.category}:${finding.title}`;
  const previousMap = new Map(previousFindings.map((finding) => [keyFor(finding), finding]));
  const currentMap = new Map(currentFindings.map((finding) => [keyFor(finding), finding]));
  const findings: FindingComparison[] = [];

  for (const [key, previousFinding] of previousMap) {
    const currentFinding = currentMap.get(key);
    if (!currentFinding) {
      findings.push({
        findingId: previousFinding.id,
        status: "REMOVED",
        changedFields: [],
      });
      continue;
    }
    const changedFields = (
      ["description", "severity", "evidenceStatus", "detectedValue", "expectedValue", "sourceReference", "confidence"] as const
    ).filter((field) =>
      JSON.stringify(previousFinding[field] ?? null) !==
      JSON.stringify(currentFinding[field] ?? null),
    );
    findings.push({
      findingId: currentFinding.id,
      status: changedFields.length > 0 ? "CHANGED" : "UNCHANGED",
      changedFields,
    });
  }
  for (const [key, currentFinding] of currentMap) {
    if (!previousMap.has(key)) {
      findings.push({
        findingId: currentFinding.id,
        status: "ADDED",
        changedFields: [],
      });
    }
  }
  return {
    previousRunId,
    currentRunId,
    previousStatus,
    currentStatus,
    findings,
    summary: {
      added: findings.filter((finding) => finding.status === "ADDED").length,
      removed: findings.filter((finding) => finding.status === "REMOVED").length,
      changed: findings.filter((finding) => finding.status === "CHANGED").length,
      unchanged: findings.filter((finding) => finding.status === "UNCHANGED").length,
    },
  };
}

function findingKey(finding: ReviewFinding): string {
  if (finding.ruleId) return `${finding.category}:${finding.ruleId}`;
  if (finding.location?.pageNumber)
    return `${finding.category}:page-${finding.location.pageNumber}:${finding.issue}`;
  return `${finding.category}:${finding.issue}`;
}

function compareFindingFields(
  previous: ReviewFinding,
  current: ReviewFinding,
): string[] {
  const fields: string[] = [];
  const comparedFields: Array<keyof ReviewFinding> = [
    "status",
    "severity",
    "issue",
    "description",
    "detectedValue",
    "expectedValue",
    "explanation",
    "suggestedCorrection",
    "evidenceReferences",
    "location",
    "confidence",
  ];
  for (const field of comparedFields) {
    if (
      JSON.stringify(previous[field] ?? null) !==
      JSON.stringify(current[field] ?? null)
    ) {
      fields.push(field);
    }
  }
  return fields;
}

export function compareAnalysisRuns(
  previous: AnalysisResponse,
  current: AnalysisResponse,
): AnalysisComparison {
  const previousByKey = new Map(
    previous.findings.map((finding) => [findingKey(finding), finding]),
  );
  const currentByKey = new Map(
    current.findings.map((finding) => [findingKey(finding), finding]),
  );
  const comparisons: FindingComparison[] = [];

  for (const [key, previousFinding] of previousByKey) {
    const currentFinding = currentByKey.get(key);
    if (!currentFinding) {
      comparisons.push({
        findingId: previousFinding.findingId,
        status: "REMOVED",
        previous: previousFinding,
        changedFields: [],
      });
      continue;
    }
    const changedFields = compareFindingFields(previousFinding, currentFinding);
    comparisons.push({
      findingId: currentFinding.findingId,
      status: changedFields.length > 0 ? "CHANGED" : "UNCHANGED",
      previous: previousFinding,
      current: currentFinding,
      changedFields,
    });
  }

  for (const [key, currentFinding] of currentByKey) {
    if (!previousByKey.has(key)) {
      comparisons.push({
        findingId: currentFinding.findingId,
        status: "ADDED",
        current: currentFinding,
        changedFields: [],
      });
    }
  }

  return {
    previousRunId: previous.analysisRunId,
    currentRunId: current.analysisRunId,
    previousStatus: previous.analysisStatus,
    currentStatus: current.analysisStatus,
    findings: comparisons,
    summary: {
      added: comparisons.filter((item) => item.status === "ADDED").length,
      removed: comparisons.filter((item) => item.status === "REMOVED").length,
      changed: comparisons.filter((item) => item.status === "CHANGED").length,
      unchanged: comparisons.filter((item) => item.status === "UNCHANGED").length,
    },
  };
}
