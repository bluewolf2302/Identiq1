import type {
  AnalysisRequest,
  AnalysisResponse,
  BrandContext,
  CreativePayload,
  ReviewFinding,
} from "../contracts";
import type { BrandContextRetrieval, BrandKnowledgeRecord } from "../brand-context";
import type {
  AiAnalysisInput,
  AiAnalysisResult,
} from "../ai";
import type {
  DeterministicTextAnalysisInput,
  DeterministicTextAnalysisResult,
} from "../governance";
import type { VisualAnalysisResult } from "../visual/types";

export type BrandContextRetriever = {
  getForSubmission(query: {
    brandId: string;
    submissionId?: string;
    contentPlatform?: string;
  }): Promise<BrandContextRetrieval>;
};

export type DeterministicAnalyzer = {
  analyze(
    input: DeterministicTextAnalysisInput,
  ): DeterministicTextAnalysisResult;
};

export type SemanticAnalyzer = {
  analyze(input: AiAnalysisInput): Promise<AiAnalysisResult>;
};

export type VisualAnalyzer = {
  analyze(input: {
    creative: CreativePayload;
    brandId: string;
    brandContext: BrandContext;
    brandKnowledgeRecord?: BrandKnowledgeRecord;
    reviewId: string;
    analysisRunId: string;
  }): Promise<VisualAnalysisResult>;
};

export type AnalysisOrchestratorDependencies = {
  brandContextService: BrandContextRetriever;
  deterministicEngine: DeterministicAnalyzer;
  aiAnalysisService: SemanticAnalyzer;
  visualAnalyzer?: VisualAnalyzer;
  getBrandKnowledgeRecord?: (brandId: string) => Promise<BrandKnowledgeRecord | null>;
  createAnalysisRunId?: () => string;
  now?: () => Date;
};

export type AnalysisExecution = {
  request: AnalysisRequest;
  context: BrandContext;
  findings: ReviewFinding[];
  warnings: string[];
  providerUsed: string;
  fallbackUsed: boolean;
  analysisStatus: AnalysisResponse["analysisStatus"];
};
