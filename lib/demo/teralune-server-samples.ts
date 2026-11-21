import fs from "node:fs/promises";
import path from "node:path";
import { createBrandKnowledgeRepository } from "@/lib/brand-context/repository-factory";
import {
  TERALUNE_DEMO_BRAND_ID,
  type DemoReadinessCheckResult,
  type TeraluneSampleVariant,
} from "./teralune-demo-fixtures";

export interface TeraluneSampleFileSpec {
  variant: TeraluneSampleVariant | "legacy";
  downloadName: string;
  publicUrl: string | null;
  relativePaths: string[];
}

const SAMPLE_FILE_SPECS: Record<TeraluneSampleVariant | "legacy", TeraluneSampleFileSpec> = {
  compliant: {
    variant: "compliant",
    downloadName: "Teralune_100_Percent_Compliant_Advertisement.pdf",
    publicUrl:
      "/assets/aistudio/Teralune_100_Percent_Compliant_Advertisement_77d8015e.pdf",
    relativePaths: [
      "public/assets/aistudio/Teralune_100_Percent_Compliant_Advertisement_77d8015e.pdf",
    ],
  },
  risky: {
    variant: "risky",
    downloadName: "Teralune_0_Percent_Compliance_Test_Advertisement.pdf",
    publicUrl:
      "/assets/aistudio/Teralune_0_Percent_Compliance_Test_Advertisement_15326428.pdf",
    relativePaths: [
      "public/assets/aistudio/Teralune_0_Percent_Compliance_Test_Advertisement_15326428.pdf",
    ],
  },
  guidelines: {
    variant: "guidelines",
    downloadName: "Teralune_Brand_Identity_and_AI_Guidelines.pdf",
    publicUrl:
      "/assets/aistudio/Teralune_Brand_Identity_and_AI_Guidelines_034bd417.pdf",
    relativePaths: [
      "public/assets/aistudio/Teralune_Brand_Identity_and_AI_Guidelines_034bd417.pdf",
      "sample-data/teralune/brand-identity-guidelines.pdf",
    ],
  },
  legacy: {
    variant: "legacy",
    downloadName: "test-advertisement.pdf",
    publicUrl:
      "/assets/aistudio/Teralune_0_Percent_Compliance_Test_Advertisement_15326428.pdf",
    relativePaths: [
      "sample-data/teralune/test-advertisement.pdf",
      "public/assets/aistudio/Teralune_0_Percent_Compliance_Test_Advertisement_15326428.pdf",
    ],
  },
};

export function resolveTeraluneSampleSpec(
  rawSampleParam: string | null | undefined,
): TeraluneSampleFileSpec {
  const key = (rawSampleParam || "").trim().toLowerCase();
  if (key === "compliant") return SAMPLE_FILE_SPECS.compliant;
  if (key === "risky") return SAMPLE_FILE_SPECS.risky;
  if (key === "guidelines") return SAMPLE_FILE_SPECS.guidelines;
  return SAMPLE_FILE_SPECS.legacy;
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function readTeraluneSamplePdf(
  rawSampleParam: string | null | undefined,
): Promise<{
  variant: TeraluneSampleVariant | "legacy";
  fileName: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  base64Data: string;
  publicUrl: string | null;
}> {
  const spec = resolveTeraluneSampleSpec(rawSampleParam);
  for (const rel of spec.relativePaths) {
    const absPath = path.join(process.cwd(), rel);
    try {
      const buffer = await fs.readFile(absPath);
      return {
        variant: spec.variant,
        fileName: spec.downloadName,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        base64Data: buffer.toString("base64"),
        publicUrl: spec.publicUrl,
      };
    } catch {
      // Try next fallback relative path
    }
  }
  throw new Error(`Teralune demo PDF for "${spec.variant}" is unavailable on disk.`);
}

/**
 * Evaluates server-side demo readiness without exposing secret values.
 */
export async function evaluateDemoReadiness(): Promise<DemoReadinessCheckResult> {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const aiProviderReady = geminiConfigured || openrouterConfigured;
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
  const serviceRoleConfigured = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );

  const [guidelinesPdf, compliantAdPdf, riskyAdPdf] = await Promise.all([
    fileExists(SAMPLE_FILE_SPECS.guidelines.relativePaths[0]!),
    fileExists(SAMPLE_FILE_SPECS.compliant.relativePaths[0]!),
    fileExists(SAMPLE_FILE_SPECS.risky.relativePaths[0]!),
  ]);
  const sampleFilesAvailable = guidelinesPdf && compliantAdPdf && riskyAdPdf;

  let teraluneBrandReady = false;
  let publishedRuleCount = 0;
  let latestPublishedVersion: string | null = null;
  const warnings: string[] = [];

  try {
    const repo = createBrandKnowledgeRepository();
    const [brand, knowledge] = await Promise.all([
      repo.getBrand(TERALUNE_DEMO_BRAND_ID),
      repo.getBrandKnowledge({ brandId: TERALUNE_DEMO_BRAND_ID }),
    ]);

    if (brand && knowledge && brand.approved) {
      teraluneBrandReady = true;
      publishedRuleCount =
        brand.publishedEntryCount ||
        knowledge.guidelines.length +
          knowledge.productFacts.length +
          knowledge.promotionalClaims.length +
          knowledge.terminology.length +
          knowledge.visualAssets.length;
      latestPublishedVersion =
        brand.latestPublishedVersion || knowledge.profile.source.versionId || "1.0";
    } else {
      warnings.push(
        "Teralune brand guidelines are not published in the active knowledge repository.",
      );
    }
  } catch (err) {
    warnings.push(
      err instanceof Error
        ? `Unable to verify Teralune Knowledge Hub state: ${err.message}`
        : "Unable to verify Teralune Knowledge Hub state.",
    );
  }

  if (!aiProviderReady) {
    warnings.push(
      "Live AI provider keys are not configured on this server; reviews will run deterministic governance & OCR inspection only (partial coverage).",
    );
  }

  if (!sampleFilesAvailable) {
    warnings.push(
      "One or more Teralune PDF fixtures are missing from the server sample directory.",
    );
  }

  return {
    status: teraluneBrandReady && sampleFilesAvailable ? "ready" : "attention_needed",
    geminiConfigured,
    openrouterConfigured,
    aiProviderReady,
    supabaseConfigured,
    serviceRoleConfigured,
    sampleFilesAvailable,
    sampleFiles: {
      guidelinesPdf,
      compliantAdPdf,
      riskyAdPdf,
    },
    teraluneBrandReady,
    publishedRuleCount,
    latestPublishedVersion,
    warnings,
  };
}
