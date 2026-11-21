import {
  BrandContextService,
  createBrandKnowledgeRepository,
} from "../brand-context";
import { createAiAnalysisServiceFromEnvironment } from "../ai";
import { DeterministicTextGovernanceEngine } from "../governance";
import { analyzeCreativeVisually } from "../visual";
import { AnalysisOrchestrator } from "./analysis-orchestrator";

export function createAnalysisOrchestrator(): AnalysisOrchestrator {
  const repository = createBrandKnowledgeRepository();
  return new AnalysisOrchestrator({
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
