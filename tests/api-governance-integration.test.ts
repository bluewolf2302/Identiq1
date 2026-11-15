import assert from "node:assert/strict";
import test from "node:test";

import {
  AnalysisOrchestrationError,
  adaptBackendResponse,
  adaptFrontendRequest,
  handleAnalysisRequest,
  InvalidAnalysisResponsePayloadError,
  InvalidBackendAnalysisResponseError,
  InvalidFrontendAnalysisRequestError,
  parseAnalysisResponsePayload,
  UnsupportedDemoBrandError,
} from "../lib/analysis";
import type { AnalysisResponse } from "../lib/contracts";
import { BrandNotFoundError } from "../lib/brand-context";

const frontendRequest = {
  title: "Demo campaign",
  contentType: "Campaign Copy" as const,
  guidelineCollection: "Teralune Brand Identity & AI Guidelines v1.0",
  textContent: "Use guaranteed results for every customer.",
  knowledgeSummary: ["This string is not treated as verified evidence."],
};

const backendResponse: AnalysisResponse = {
  submissionId: "submission-1",
  analysisRunId: "run-1",
  analysisStatus: "COMPLETED",
  providerUsed: "fake-ai",
  fallbackUsed: true,
  analysisTimestamp: "2026-01-02T03:04:05.000Z",
  findings: [
    {
      findingId: "finding-1",
      category: "TONE_AND_TERMINOLOGY",
      severity: "HIGH",
      status: "CONFLICTING",
      issue: "Prohibited terminology",
      description: "The content uses terminology that is not approved.",
      detectedValue: "guaranteed",
      expectedValue: "customer",
      explanation: "The approved context prohibits this term.",
      suggestedCorrection: "Use an approved alternative.",
      evidenceReferences: [
        {
          sourceId: "SRC-CLAIM-01",
          sourceType: "brand-handbook",
          sourceTitle: "Teralune Approved Marketing Claims (fictional)",
          versionId: "1.0",
        },
      ],
      location: { startOffset: 4, endOffset: 14 },
      analysisProvider: "deterministic",
    },
  ],
};

test("adapts a valid frontend request to the actual demo brand fixture", () => {
  const request = adaptFrontendRequest(frontendRequest, {
    createSubmissionId: () => "submission-generated",
  });

  assert.equal(request.brandId, "demo-brand-teralune");
  assert.equal(request.submissionId, "submission-generated");
  assert.equal(request.campaignName, frontendRequest.title);
  assert.equal(request.contentText, frontendRequest.textContent);
});

test("preserves a frontend-provided submission ID", () => {
  const request = adaptFrontendRequest(
    { ...frontendRequest, submissionId: "submission-existing" },
    { createSubmissionId: () => "should-not-be-used" },
  );
  assert.equal(request.submissionId, "submission-existing");
});

test("rejects malformed frontend requests and unknown demo collections", () => {
  assert.throws(
    () => adaptFrontendRequest({ title: "missing fields" }),
    InvalidFrontendAnalysisRequestError,
  );
  assert.throws(
    () =>
      adaptFrontendRequest({
        ...frontendRequest,
        guidelineCollection: "Aura Botanicals Global v2.4",
      }),
    UnsupportedDemoBrandError,
  );
  assert.throws(
    () =>
      adaptFrontendRequest({
        ...frontendRequest,
        guidelineCollection: "Northstar Pay Compliance v1.8",
      }),
    UnsupportedDemoBrandError,
  );
  assert.throws(
    () =>
      adaptFrontendRequest({
        ...frontendRequest,
        guidelineCollection: "Unconfigured collection",
      }),
    UnsupportedDemoBrandError,
  );
});

test("maps backend findings without fabricating evidence", () => {
  const response = adaptBackendResponse(backendResponse, frontendRequest.textContent);
  const finding = response.findings[0];

  assert.equal(response.submissionId, "submission-1");
  assert.equal(response.analysisRunId, "run-1");
  assert.equal(response.analysisStatus, "COMPLETED");
  assert.equal(response.fallbackUsed, true);
  assert.equal(finding?.category, "Tone & Voice");
  assert.equal(finding?.severity, "high");
  assert.equal(finding?.evidenceStatus, "conflicting");
  assert.equal(finding?.sourceReference.includes("SRC-CLAIM-01"), true);
  assert.deepEqual(finding?.sourceVersionIds, ["1.0"]);
  assert.equal(finding?.affectedContent, "guaranteed");
});

test("passes successful orchestrator responses through the route handler", async () => {
  let received: unknown;
  const result = await handleAnalysisRequest(frontendRequest, {
    orchestrator: {
      analyze: async (request) => {
        received = request;
        return backendResponse;
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { submissionId: string }).submissionId, "submission-1");
  assert.equal(
    (received as { brandId: string }).brandId,
    "demo-brand-teralune",
  );
});

test("maps AI failure to service unavailable instead of clean success", async () => {
  const result = await handleAnalysisRequest(frontendRequest, {
    orchestrator: {
      analyze: async () => {
        throw new AnalysisOrchestrationError(
          "ai",
          "AI semantic analysis failed.",
        );
      },
    },
  });
  assert.equal(result.status, 503);
  assert.equal(
    (result.body as { error: string }).error,
    "AI semantic analysis is currently unavailable.",
  );
});

test("maps missing brand and deterministic failures to safe HTTP errors", async () => {
  const missingBrand = await handleAnalysisRequest(frontendRequest, {
    orchestrator: {
      analyze: async () => {
        throw new AnalysisOrchestrationError(
          "brand-context",
          "No brand knowledge was found.",
          new BrandNotFoundError("brand-001"),
        );
      },
    },
  });
  assert.equal(missingBrand.status, 404);
  assert.equal(
    (missingBrand.body as { error: string }).error,
    "No approved brand context was found for this submission.",
  );

  const deterministicFailure = await handleAnalysisRequest(frontendRequest, {
    orchestrator: {
      analyze: async () => {
        throw new AnalysisOrchestrationError(
          "deterministic",
          "Deterministic analysis failed.",
        );
      },
    },
  });
  assert.equal(deterministicFailure.status, 500);
  assert.equal(
    (deterministicFailure.body as { error: string }).error,
    "Deterministic governance analysis failed.",
  );
});

test("rejects invalid backend responses without exposing provider details", () => {
  assert.throws(
    () =>
      adaptBackendResponse(
        { providerUsed: "provider-secret-value" },
        frontendRequest.textContent,
      ),
    InvalidBackendAnalysisResponseError,
  );
});

test("validates the frontend response payload before review creation", () => {
  const payload = adaptBackendResponse(backendResponse, frontendRequest.textContent);
  assert.equal(parseAnalysisResponsePayload(payload).providerUsed, "fake-ai");
  for (const field of ["comments", "category", "resolved"] as const) {
    const invalidPayload = structuredClone(payload) as unknown as {
      findings: Array<Record<string, unknown>>;
    };
    delete invalidPayload.findings[0][field];
    assert.throws(
      () => parseAnalysisResponsePayload(invalidPayload),
      InvalidAnalysisResponsePayloadError,
    );
  }
  assert.throws(
    () => parseAnalysisResponsePayload({ ...payload, fallbackUsed: "false" }),
    InvalidAnalysisResponsePayloadError,
  );
});

test("maps unexpected orchestration exceptions to a safe server error", async () => {
  const result = await handleAnalysisRequest(frontendRequest, {
    orchestrator: {
      analyze: async () => {
        throw new Error("provider secret and stack details");
      },
    },
  });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: "Unable to complete brand governance analysis.",
  });
});
