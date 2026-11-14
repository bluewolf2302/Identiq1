import {
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  type AnalysisRequest,
  type AnalysisResponse,
  type BrandContext,
  type ReviewFinding,
} from "../contracts";
import {
  BrandNotFoundError,
  type BrandContextRetrieval,
  type BrandKnowledgeRecord,
} from "../brand-context";
import { VisualValidationError, type VisualAnalysisResult } from "../visual";
import { mergeFindings } from "./finding-merger";
import type {
  AnalysisOrchestratorDependencies,
  BrandContextRetriever,
  DeterministicAnalyzer,
  SemanticAnalyzer,
  VisualAnalyzer,
} from "./types";

export type AnalysisFailureStage =
  | "request-validation"
  | "brand-context"
  | "visual-validation"
  | "visual"
  | "deterministic"
  | "ai"
  | "response-validation";

export class AnalysisOrchestrationError extends Error {
  readonly stage: AnalysisFailureStage;
  readonly cause: unknown;

  constructor(
    stage: AnalysisFailureStage,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AnalysisOrchestrationError";
    this.stage = stage;
    this.cause = cause;
  }
}

export class InvalidAnalysisRequestError extends AnalysisOrchestrationError {
  readonly issues: unknown;

  constructor(issues: unknown) {
    super(
      "request-validation",
      "The analysis request is invalid.",
      issues,
    );
    this.name = "InvalidAnalysisRequestError";
    this.issues = issues;
  }
}

export class AnalysisResponseValidationError extends AnalysisOrchestrationError {
  readonly issues: unknown;

  constructor(issues: unknown) {
    super(
      "response-validation",
      "The analysis response failed contract validation.",
      issues,
    );
    this.name = "AnalysisResponseValidationError";
    this.issues = issues;
  }
}

function defaultRunId(): string {
  return globalThis.crypto?.randomUUID() ?? `analysis-${Date.now()}`;
}

function toSafeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Analysis dependency failed.";
}

function combineSubmissionAndOcrText(
  userText: string,
  ocrText: string,
): string {
  const cleanUser = userText.trim();
  const cleanOcr = ocrText.trim();
  if (!cleanOcr) return cleanUser;
  if (!cleanUser) return cleanOcr;

  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const userNorm = normalize(cleanUser);
  const ocrLines = cleanOcr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const uniqueOcrLines = ocrLines.filter(
    (line) => !userNorm.includes(normalize(line)),
  );
  if (uniqueOcrLines.length === 0) {
    return cleanUser;
  }
  return `${cleanUser}\n\n${uniqueOcrLines.join("\n")}`;
}

export class AnalysisOrchestrator {
  private readonly brandContextService: BrandContextRetriever;
  private readonly deterministicEngine: DeterministicAnalyzer;
  private readonly aiAnalysisService: SemanticAnalyzer;
  private readonly visualAnalyzer?: VisualAnalyzer;
  private readonly getBrandKnowledgeRecord?: (
    brandId: string,
  ) => Promise<BrandKnowledgeRecord | null>;
  private readonly createAnalysisRunId: () => string;
  private readonly now: () => Date;

  constructor(dependencies: AnalysisOrchestratorDependencies) {
    this.brandContextService = dependencies.brandContextService;
    this.deterministicEngine = dependencies.deterministicEngine;
    this.aiAnalysisService = dependencies.aiAnalysisService;
    this.visualAnalyzer = dependencies.visualAnalyzer;
    this.getBrandKnowledgeRecord = dependencies.getBrandKnowledgeRecord;
    this.createAnalysisRunId = dependencies.createAnalysisRunId ?? defaultRunId;
    this.now = dependencies.now ?? (() => new Date());
  }

  async analyze(input: unknown): Promise<AnalysisResponse> {
    const request = AnalysisRequestSchema.safeParse(input);
    if (!request.success) {
      throw new InvalidAnalysisRequestError(request.error.issues);
    }

    const analysisRunId = this.createAnalysisRunId();
    const contextResult = await this.retrieveContext(request.data);

    let visualResult: VisualAnalysisResult | undefined;
    if (request.data.creativePayload && this.visualAnalyzer) {
      visualResult = await this.runVisual(
        request.data,
        contextResult.context,
        analysisRunId,
      );
    }

    const content = combineSubmissionAndOcrText(
      request.data.contentText ?? "",
      visualResult?.extractedText ?? "",
    );

    const deterministicFindings = this.runDeterministic(content, contextResult);
    let semanticResult: {
      findings: ReviewFinding[];
      providerUsed: string;
      fallbackUsed: boolean;
      error?: string;
    };

    try {
      semanticResult = await this.runSemantic(
        content,
        contextResult,
        deterministicFindings,
      );
    } catch (error) {
      // If there are no deterministic findings AND no visual result, rethrow error to preserve test contract
      if (deterministicFindings.length === 0 && !visualResult) {
        throw error;
      }
      semanticResult = {
        findings: [],
        providerUsed: "none",
        fallbackUsed: false,
        error: toSafeFailureMessage(error),
      };
    }

    const findings = mergeFindings(
      deterministicFindings,
      semanticResult.findings,
      visualResult?.canonicalFindings ?? [],
    );

    const isPartial =
      contextResult.warnings.length > 0 ||
      visualResult?.status === "PARTIAL" ||
      Boolean(semanticResult.error);

    const isVisualFallback = Boolean(
      visualResult?.visionProviderUsed &&
        (visualResult.visionProviderUsed.includes("openrouter") ||
          visualResult.warnings.some((w) => w.toLowerCase().includes("fallback"))),
    );

    const resolvedProvider =
      semanticResult.providerUsed !== "none"
        ? semanticResult.providerUsed
        : visualResult?.visionProviderUsed ?? "deterministic-governance";

    const responseInput = {
      submissionId: request.data.submissionId,
      analysisRunId,
      analysisStatus: isPartial ? ("PARTIAL" as const) : ("COMPLETED" as const),
      findings,
      providerUsed: resolvedProvider,
      fallbackUsed: semanticResult.fallbackUsed || isVisualFallback,
      analysisTimestamp: this.now().toISOString(),
      ...(visualResult
        ? {
            ocrBlocks: visualResult.ocrBlocks,
            visualSummary: {
              status: visualResult.status,
              assetId: visualResult.creativeMetadata.assetId,
              fileName: visualResult.creativeMetadata.fileName,
              format: visualResult.creativeMetadata.format,
              sizeBytes: visualResult.creativeMetadata.sizeBytes,
              pageCount: visualResult.creativeMetadata.pageCount,
              processedPageCount: visualResult.creativeMetadata.processedPageCount,
              extractedText: visualResult.extractedText,
              ...(visualResult.visionProviderUsed
                ? { visionProviderUsed: visualResult.visionProviderUsed }
                : {}),
              pages: visualResult.pages.map((p) => ({
                pageNumber: p.pageNumber,
                width: p.width,
                height: p.height,
                rotation: p.rotation,
                imageWidth: p.imageWidth,
                imageHeight: p.imageHeight,
                status: p.status,
                ...(p.error ? { error: p.error } : {}),
                ...(p.previewDataUrl ? { previewDataUrl: p.previewDataUrl } : {}),
              })),
              warnings: visualResult.warnings,
              errors: visualResult.errors,
            },
          }
        : {}),
    };

    const response = AnalysisResponseSchema.safeParse(responseInput);
    if (!response.success) {
      throw new AnalysisResponseValidationError(response.error.issues);
    }
    return response.data;
  }

  private async retrieveContext(
    request: AnalysisRequest,
  ): Promise<BrandContextRetrieval> {
    try {
      return await this.brandContextService.getForSubmission({
        brandId: request.brandId,
        submissionId: request.submissionId,
        contentPlatform: request.contentPlatform,
      });
    } catch (error) {
      const message =
        error instanceof BrandNotFoundError
          ? error.message
          : `Brand context retrieval failed: ${toSafeFailureMessage(error)}`;
      throw new AnalysisOrchestrationError("brand-context", message, error);
    }
  }

  private async runVisual(
    request: AnalysisRequest,
    brandContext: BrandContext,
    analysisRunId: string,
  ): Promise<VisualAnalysisResult> {
    if (!this.visualAnalyzer || !request.creativePayload) {
      throw new AnalysisOrchestrationError(
        "visual",
        "Visual analyzer is not configured.",
      );
    }

    try {
      const rawRecord = this.getBrandKnowledgeRecord
        ? (await this.getBrandKnowledgeRecord(request.brandId)) ?? undefined
        : undefined;

      const result = await this.visualAnalyzer.analyze({
        creative: request.creativePayload,
        brandId: request.brandId,
        brandContext,
        brandKnowledgeRecord: rawRecord,
        reviewId: request.submissionId,
        analysisRunId,
      });

      if (result.status === "FAILED") {
        throw new AnalysisOrchestrationError(
          "visual",
          result.errors[0] ?? "Visual analysis failed across all pages.",
        );
      }

      return result;
    } catch (error) {
      if (error instanceof AnalysisOrchestrationError) {
        throw error;
      }
      if (error instanceof VisualValidationError) {
        throw new AnalysisOrchestrationError(
          "visual-validation",
          error.message,
          error,
        );
      }
      throw new AnalysisOrchestrationError(
        "visual",
        `Visual creative analysis failed: ${toSafeFailureMessage(error)}`,
        error,
      );
    }
  }

  private runDeterministic(
    content: string,
    contextResult: BrandContextRetrieval,
  ): ReviewFinding[] {
    try {
      return this.deterministicEngine.analyze({
        content,
        brandContext: contextResult.context,
      }).findings;
    } catch (error) {
      throw new AnalysisOrchestrationError(
        "deterministic",
        `Deterministic analysis failed: ${toSafeFailureMessage(error)}`,
        error,
      );
    }
  }

  private async runSemantic(
    content: string,
    contextResult: BrandContextRetrieval,
    deterministicFindings: ReviewFinding[],
  ) {
    try {
      return await this.aiAnalysisService.analyze({
        content,
        brandContext: contextResult.context,
        deterministicFindings,
      });
    } catch (error) {
      throw new AnalysisOrchestrationError(
        "ai",
        "AI semantic analysis failed.",
        error,
      );
    }
  }
}
