import {
  AnalysisOrchestrationError,
  AnalysisResponseValidationError,
} from "./analysis-orchestrator";
import {
  adaptBackendResponse,
  adaptFrontendRequest,
  InvalidBackendAnalysisResponseError,
  InvalidFrontendAnalysisRequestError,
  UnsupportedDemoBrandError,
} from "./api-adapters";
import type { AnalysisOrchestrator } from "./analysis-orchestrator";
import { BrandNotFoundError } from "../brand-context";

type AnalysisRouteDependencies = {
  orchestrator: Pick<AnalysisOrchestrator, "analyze">;
};

function createFailedAnalysisPayload(
  frontendRequest:
    | ReturnType<typeof adaptFrontendRequest>
    | undefined,
  stage: AnalysisOrchestrationError["stage"],
) {
  const coverage = {
    brandContext:
      stage === "brand-context"
        ? { status: "FAILED" as const, reason: "Approved brand context could not be retrieved." }
        : { status: "COMPLETED" as const },
    deterministic:
      stage === "deterministic"
        ? { status: "FAILED" as const, reason: "Deterministic analysis failed." }
        : { status: "COMPLETED" as const },
    semanticAI:
      stage === "ai"
        ? { status: "FAILED" as const, reason: "AI semantic analysis is unavailable." }
        : { status: "SKIPPED" as const },
    visual:
      stage === "visual" || stage === "visual-validation"
        ? { status: "FAILED" as const, reason: "Visual creative analysis failed." }
        : { status: "SKIPPED" as const },
    ocr:
      stage === "visual" || stage === "visual-validation"
        ? { status: "FAILED" as const, reason: "OCR or visual processing could not complete." }
        : { status: "SKIPPED" as const },
  };

  const submissionId = frontendRequest?.submissionId ?? "unknown-submission";
  const previousAnalysisRunId = frontendRequest?.previousAnalysisRunId;

  return {
    submissionId,
    analysisRunId: `${submissionId}-failed`,
    ...(previousAnalysisRunId
      ? { previousAnalysisRunId }
      : {}),
    analysisStatus: "FAILED" as const,
    fallbackUsed: false,
    complianceScore: 100,
    providerUsed: "none",
    summary: "The governance analysis failed and no clean pass is asserted.",
    findings: [],
    coverage,
  };
}

export async function handleAnalysisRequest(
  input: unknown,
  dependencies: AnalysisRouteDependencies,
): Promise<{ status: number; body: unknown }> {
  let frontendRequest: ReturnType<typeof adaptFrontendRequest> | undefined;
  try {
    frontendRequest = adaptFrontendRequest(input);
    const backendResponse = await dependencies.orchestrator.analyze(
      frontendRequest,
    );
    return {
      status: 200,
      body: adaptBackendResponse(
        backendResponse,
        frontendRequest.contentText ?? "",
      ),
    };
  } catch (error) {
    if (error instanceof InvalidFrontendAnalysisRequestError) {
      return {
        status: 400,
        body: { error: error.message },
      };
    }
    if (error instanceof UnsupportedDemoBrandError) {
      return {
        status: 422,
        body: { error: error.message },
      };
    }
    if (
      error instanceof AnalysisResponseValidationError ||
      error instanceof InvalidBackendAnalysisResponseError
    ) {
      return {
        status: 502,
        body: { error: "The governance analysis returned an invalid response." },
      };
    }
    if (error instanceof AnalysisOrchestrationError) {
      if (
        error.stage === "brand-context" &&
        error.cause instanceof BrandNotFoundError
      ) {
        return {
          status: 404,
          body: createFailedAnalysisPayload(frontendRequest, error.stage),
        };
      }
      if (error.stage === "ai") {
        return {
          status: 503,
          body: createFailedAnalysisPayload(frontendRequest, error.stage),
        };
      }
      if (error.stage === "visual-validation") {
        return {
          status: 400,
          body: createFailedAnalysisPayload(frontendRequest, error.stage),
        };
      }
      if (error.stage === "visual") {
        return {
          status: 500,
          body: frontendRequest
            ? createFailedAnalysisPayload(frontendRequest, error.stage)
            : { error: "Unable to complete brand governance analysis." },
        };
      }
      if (error.stage === "deterministic") {
        return {
          status: 500,
          body: createFailedAnalysisPayload(frontendRequest, error.stage),
        };
      }
      if (error.stage === "brand-context") {
        return {
          status: 502,
          body: createFailedAnalysisPayload(frontendRequest, error.stage),
        };
      }
      return {
        status: 500,
        body: createFailedAnalysisPayload(frontendRequest, error.stage),
      };
    }
    return {
      status: 500,
      body: frontendRequest
        ? createFailedAnalysisPayload(frontendRequest, "response-validation")
        : { error: "Unable to complete brand governance analysis." },
    };
  }
}
