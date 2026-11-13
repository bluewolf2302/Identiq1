import {
  BrandContextService,
  MockBrandKnowledgeRepository,
} from "../brand-context";
import { createAiAnalysisServiceFromEnvironment } from "../ai";
import { DeterministicTextGovernanceEngine } from "../governance";
import { AnalysisOrchestrator } from "./analysis-orchestrator";

let orchestrator: AnalysisOrchestrator | undefined;

export function createAnalysisOrchestrator(): AnalysisOrchestrator {
  if (!orchestrator || process.env.NODE_ENV !== "production") {
    const repository = new MockBrandKnowledgeRepository();
    orchestrator = new AnalysisOrchestrator({
      brandContextService: new BrandContextService(repository),
      deterministicEngine: new DeterministicTextGovernanceEngine(),
      aiAnalysisService: createAiAnalysisServiceFromEnvironment(),
    });
  }
  return orchestrator;
}
