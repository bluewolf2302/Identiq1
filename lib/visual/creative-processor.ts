import { getVisualPipelineConfig, type VisualPipelineConfig } from "./config";
import { validateCreativeFile } from "./file-validation";
import { processImageCreative } from "./image-processor";
import { processPdfCreative } from "./pdf-processor";
import type {
  CreativeFileInput,
  ProcessedPage,
  ValidatedCreativeFile,
  VisualAnalysisDependencies,
} from "./types";

export interface CreativeProcessingOutput {
  validatedFile: ValidatedCreativeFile;
  totalPageCount: number;
  pages: ProcessedPage[];
  warnings: string[];
}

export async function processCreativeFile(
  input: CreativeFileInput,
  dependencies: VisualAnalysisDependencies = {},
): Promise<CreativeProcessingOutput> {
  const config: VisualPipelineConfig = getVisualPipelineConfig(dependencies.config);
  const validatedFile = await validateCreativeFile(input, config);

  if (validatedFile.format === "pdf") {
    const pdfResult = await processPdfCreative(validatedFile, config, {
      pageRenderer: dependencies.pdfPageRenderer,
    });
    return {
      validatedFile,
      totalPageCount: pdfResult.totalPageCount,
      pages: pdfResult.pages,
      warnings: pdfResult.warnings,
    };
  }

  const pages = await processImageCreative(validatedFile, config);
  return {
    validatedFile,
    totalPageCount: 1,
    pages,
    warnings: [],
  };
}
