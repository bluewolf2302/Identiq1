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

export async function handleAnalysisRequest(
  input: unknown,
  dependencies: AnalysisRouteDependencies,
): Promise<{ status: number; body: unknown }> {
  try {
    const frontendRequest = adaptFrontendRequest(input);
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
          body: { error: "No approved brand context was found for this submission." },
        };
      }
      if (error.stage === "ai") {
        return {
          status: 503,
          body: { error: "AI semantic analysis is currently unavailable." },
        };
      }
      if (error.stage === "visual-validation") {
        return {
          status: 400,
          body: { error: error.message },
        };
      }
      if (error.stage === "visual") {
        return {
          status: 500,
          body: { error: "Visual creative analysis failed." },
        };
      }
      if (error.stage === "deterministic") {
        return {
          status: 500,
          body: { error: "Deterministic governance analysis failed." },
        };
      }
      if (error.stage === "brand-context") {
        return {
          status: 502,
          body: { error: "Approved brand context could not be retrieved." },
        };
      }
      return {
        status: 500,
        body: { error: "Unable to complete brand governance analysis." },
      };
    }
    return {
      status: 500,
      body: { error: "Unable to complete brand governance analysis." },
    };
  }
}
