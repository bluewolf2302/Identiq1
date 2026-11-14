import {
  BrandContextService,
  MockBrandKnowledgeRepository,
} from "../brand-context";
import { createAiAnalysisServiceFromEnvironment } from "../ai";
import { DeterministicTextGovernanceEngine } from "../governance";
import { analyzeCreativeVisually } from "../visual";
import { AnalysisOrchestrator } from "./analysis-orchestrator";

let orchestrator: AnalysisOrchestrator | undefined;

export function createAnalysisOrchestrator(): AnalysisOrchestrator {
  if (!orchestrator || process.env.NODE_ENV !== "production") {
    const repository = new MockBrandKnowledgeRepository();
    orchestrator = new AnalysisOrchestrator({
      brandContextService: new BrandContextService(repository),
      deterministicEngine: new DeterministicTextGovernanceEngine(),
      aiAnalysisService: createAiAnalysisServiceFromEnvironment(),
      getBrandKnowledgeRecord: (brandId) =>
        repository.getBrandKnowledge({ brandId }),
      visualAnalyzer: {
        analyze: async ({
          creative,
          brandContext,
          brandKnowledgeRecord,
          reviewId,
          analysisRunId,
        }) =>
          analyzeCreativeVisually({
            creative: {
              assetId: creative.assetId ?? `${reviewId}-creative`,
              fileName: creative.fileName,
              declaredMimeType: creative.mimeType,
              base64Data: creative.base64Data,
            },
            brandContext,
            brandKnowledgeRecord,
            reviewId,
            analysisRunId,
          }),
      },
    });
  }
  return orchestrator;
}
