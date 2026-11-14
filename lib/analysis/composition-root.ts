import { BrandContextService } from "../brand-context";
import { SupabaseBrandKnowledgeRepository } from "../brand-context/supabase-repository";
import { createAiAnalysisServiceFromEnvironment } from "../ai";
import { DeterministicTextGovernanceEngine } from "../governance";
import { AnalysisOrchestrator } from "./analysis-orchestrator";

let orchestrator: AnalysisOrchestrator | undefined;

export function createAnalysisOrchestrator(): AnalysisOrchestrator {
  if (!orchestrator) {
    const repository = new SupabaseBrandKnowledgeRepository();
    orchestrator = new AnalysisOrchestrator({
      brandContextService: new BrandContextService(repository),
      deterministicEngine: new DeterministicTextGovernanceEngine(),
      aiAnalysisService: createAiAnalysisServiceFromEnvironment(),
    });
  }
  return orchestrator;
}
