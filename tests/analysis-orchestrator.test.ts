import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisOrchestrator,
  AnalysisOrchestrationError,
  InvalidAnalysisRequestError,
} from "../lib/analysis";
import {
  AnalysisResponseSchema,
  type BrandContext,
  type ReviewFinding,
} from "../lib/contracts";
import {
  BrandNotFoundError,
  type BrandContextWarning,
} from "../lib/brand-context";
import { mergeFindings } from "../lib/analysis/finding-merger";

const context: BrandContext = {
  brandProfile: "Example brand",
  approvedGuidelines: ["Use a clear, confident tone."],
  approvedProductFacts: ["PRODUCT_PRICE: $20 [Source: Guide (guide-1; v1)]"],
  approvedPromotionalClaims: [],
  preferredTerminology: [],
  prohibitedTerminology: ["cheap [Source: Guide (guide-1; v1)]"],
  approvedColours: [],
  approvedVisualAssetReferences: [],
  sourceIds: ["guide-1"],
  versionId: "v1",
  sourceVersionInformation: "Guide (guide-1; v1)",
};

function finding(
  findingId: string,
  issue: string,
  provider: string,
  overrides: Partial<ReviewFinding> = {},
): ReviewFinding {
  return {
    findingId,
    category: "FACT_VERIFICATION",
    severity: "HIGH",
    status: "CONFLICTING",
    issue,
    description: "A supported test finding.",
    explanation: "The finding is backed by the supplied brand context.",
    evidenceReferences: [
      {
        sourceId: "guide-1",
        sourceType: "brand-guide",
        sourceTitle: "Guide",
        versionId: "v1",
      },
    ],
    analysisProvider: provider,
    ...overrides,
  };
}

function createOrchestrator(options: {
  deterministicFindings?: ReviewFinding[];
  semanticFindings?: ReviewFinding[];
  warnings?: BrandContextWarning[];
  retrieve?: (query: {
    brandId: string;
    submissionId?: string;
    contentPlatform?: string;
  }) => Promise<{ context: BrandContext; warnings: BrandContextWarning[] }>;
  deterministicError?: Error;
  semanticError?: Error;
}) {
  const calls = {
    query: undefined as
      | { brandId: string; submissionId?: string; contentPlatform?: string }
      | undefined,
  };
  const orchestrator = new AnalysisOrchestrator({
    brandContextService: {
      getForSubmission: async (query) => {
        calls.query = query;
        if (options.retrieve) {
          return options.retrieve(query);
        }
        return { context, warnings: options.warnings ?? [] };
      },
    },
    deterministicEngine: {
      analyze: () => {
        if (options.deterministicError) {
          throw options.deterministicError;
        }
        return { findings: options.deterministicFindings ?? [] };
      },
    },
    aiAnalysisService: {
      analyze: async () => {
        if (options.semanticError) {
          throw options.semanticError;
        }
        return {
          findings: options.semanticFindings ?? [],
          providerUsed: "fake-ai",
          fallbackUsed: false,
        };
      },
    },
    createAnalysisRunId: () => "run-1",
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  return { orchestrator, calls };
}

const request = {
  submissionId: "submission-1",
  brandId: "brand-1",
  campaignName: "Campaign",
  contentText: "Sample content",
  contentPlatform: "web",
};

test("returns a validated response with deterministic and AI findings", async () => {
  const deterministic = finding("det-1", "Price differs", "deterministic");
  const semantic = finding("ai-1", "Tone differs", "fake-ai", {
    category: "TONE_AND_TERMINOLOGY",
    severity: "MEDIUM",
    status: "NEEDS_HUMAN_REVIEW",
  });
  const { orchestrator } = createOrchestrator({
    deterministicFindings: [deterministic],
    semanticFindings: [semantic],
  });

  const response = await orchestrator.analyze(request);

  assert.deepEqual(AnalysisResponseSchema.parse(response), response);
  assert.equal(response.analysisStatus, "COMPLETED");
  assert.deepEqual(response.findings.map((item) => item.findingId), ["det-1", "ai-1"]);
  assert.equal(response.providerUsed, "fake-ai");
});

test("passes brand, submission, and platform identifiers to retrieval", async () => {
  const { orchestrator, calls } = createOrchestrator({});
  await orchestrator.analyze(request);
  assert.deepEqual(calls.query, {
    brandId: "brand-1",
    submissionId: "submission-1",
    contentPlatform: "web",
  });
});

test("marks valid incomplete brand context as partial", async () => {
  const { orchestrator } = createOrchestrator({
    warnings: ["NO_APPROVED_PRODUCT_FACTS"],
  });
  const response = await orchestrator.analyze(request);
  assert.equal(response.analysisStatus, "PARTIAL");
});

test("keeps distinct findings in the same category and removes exact duplicates", async () => {
  const duplicateDeterministic = finding("det-1", "Same issue", "deterministic", {
    location: { startOffset: 1, endOffset: 5 },
  });

  test("does not merge empty-evidence or distinct same-location findings", () => {
    const base = finding("det-1", "Product name is incorrect", "deterministic", {
      evidenceReferences: [],
      location: { startOffset: 4, endOffset: 10 },
    });
    const different = finding("ai-1", "Pack size is incorrect", "fake-ai", {
      evidenceReferences: [],
      location: { startOffset: 4, endOffset: 10 },
    });
    assert.deepEqual(mergeFindings([base], [different]).map((item) => item.findingId), [
      "det-1",
      "ai-1",
    ]);
  });

  test("merges genuinely duplicate wording while preserving distinct source issues", () => {
    const deterministic = finding("det-1", "Product name is incorrect", "deterministic", {
      location: { startOffset: 4, endOffset: 10 },
    });
    const semanticDuplicate = finding(
      "ai-1",
      "Incorrect product name",
      "fake-ai",
      { location: { startOffset: 4, endOffset: 10 } },
    );
    const semanticDistinct = finding(
      "ai-2",
      "Product price conflicts with approved value",
      "fake-ai",
      { location: { startOffset: 4, endOffset: 10 } },
    );
    assert.deepEqual(
      mergeFindings([deterministic], [semanticDuplicate, semanticDistinct]).map(
        (item) => item.findingId,
      ),
      ["det-1", "ai-2"],
    );
  });
  const duplicateAi = finding("ai-duplicate", " same   issue ", "fake-ai", {
    location: { startOffset: 1, endOffset: 5 },
  });
  const distinct = finding("ai-distinct", "Another issue", "fake-ai");
  const { orchestrator } = createOrchestrator({
    deterministicFindings: [duplicateDeterministic],
    semanticFindings: [duplicateAi, distinct],
  });
  const response = await orchestrator.analyze(request);
  assert.deepEqual(response.findings.map((item) => item.findingId), [
    "det-1",
    "ai-distinct",
  ]);
});

test("preserves evidence and version references", async () => {
  const semantic = finding("ai-1", "Evidence-backed issue", "fake-ai", {
    evidenceReferences: [
      {
        sourceId: "guide-1",
        sourceType: "brand-guide",
        sourceTitle: "Guide",
        excerpt: "Approved evidence",
        section: "Claims",
        versionId: "v1",
      },
    ],
  });

  test("does not merge findings backed by different source versions", () => {
    const left = finding("det-1", "Incorrect approved product price", "deterministic", {
      detectedValue: "$20",
      evidenceReferences: [
        {
          sourceId: "guide-1",
          sourceType: "brand-guide",
          sourceTitle: "Guide",
          versionId: "v1",
        },
      ],
    });

    test("merges a matching visual finding with its text counterpart", () => {
      const textFinding = finding("det-1", "Incorrect logo usage", "deterministic", {
        category: "VISUAL_COMPLIANCE",
        detector: "deterministic",
        location: { field: "visual:logo", pageNumber: 1 },
      });
      const visualFinding = finding("visual-1", "Incorrect logo usage", "visual-gemini", {
        category: "VISUAL_COMPLIANCE",
        detector: "gemini_vision",
        location: { field: "visual:logo", pageNumber: 1 },
      });

      assert.deepEqual(
        mergeFindings([textFinding], [], [visualFinding]).map((item) => item.findingId),
        ["det-1"],
      );
    });
    const right = finding("ai-1", "Incorrect approved product price", "fake-ai", {
      detectedValue: "$20",
      evidenceReferences: [
        {
          sourceId: "guide-1",
          sourceType: "brand-guide",
          sourceTitle: "Guide",
          versionId: "v2",
        },
      ],
    });

    assert.deepEqual(
      mergeFindings([left], [right]).map((item) => item.findingId),
      ["det-1", "ai-1"],
    );
  });
  const { orchestrator } = createOrchestrator({ semanticFindings: [semantic] });
  const response = await orchestrator.analyze(request);
  assert.equal(response.findings[0]?.evidenceReferences[0]?.versionId, "v1");
  assert.equal(response.findings[0]?.evidenceReferences[0]?.excerpt, "Approved evidence");
});

test("wraps missing brands as a brand-context orchestration failure", async () => {
  const { orchestrator } = createOrchestrator({
    retrieve: async () => {
      throw new BrandNotFoundError("brand-1");
    },
  });
  await assert.rejects(
    orchestrator.analyze(request),
    (error: unknown) =>
      error instanceof AnalysisOrchestrationError &&
      error.stage === "brand-context" &&
      error.cause instanceof BrandNotFoundError,
  );
});

test("distinguishes AI failure from a clean successful analysis", async () => {
  const { orchestrator } = createOrchestrator({
    semanticError: new Error("provider unavailable"),
  });
  await assert.rejects(
    orchestrator.analyze(request),
    (error: unknown) =>
      error instanceof AnalysisOrchestrationError && error.stage === "ai",
  );
});

test("wraps deterministic failure", async () => {
  const { orchestrator } = createOrchestrator({
    deterministicError: new Error("engine failed"),
  });
  await assert.rejects(
    orchestrator.analyze(request),
    (error: unknown) =>
      error instanceof AnalysisOrchestrationError &&
      error.stage === "deterministic",
  );
});

test("rejects malformed requests", async () => {
  const { orchestrator } = createOrchestrator({});
  await assert.rejects(
    orchestrator.analyze({ submissionId: "submission-1" }),
    (error: unknown) => error instanceof InvalidAnalysisRequestError,
  );
});

test("returns a valid successful response when no findings exist", async () => {
  const { orchestrator } = createOrchestrator({});
  const response = await orchestrator.analyze(request);
  assert.equal(response.findings.length, 0);
  assert.equal(response.analysisStatus, "COMPLETED");
});

test("does not make provider calls beyond the injected semantic analyzer", async () => {
  let calls = 0;
  const orchestrator = new AnalysisOrchestrator({
    brandContextService: {
      getForSubmission: async () => ({ context, warnings: [] }),
    },
    deterministicEngine: { analyze: () => ({ findings: [] }) },
    aiAnalysisService: {
      analyze: async () => {
        calls += 1;
        return { findings: [], providerUsed: "fake-ai", fallbackUsed: false };
      },
    },
    createAnalysisRunId: () => "run-1",
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });
  await orchestrator.analyze(request);
  assert.equal(calls, 1);
});
