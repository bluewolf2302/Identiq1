import type { BrandAsset, ContentType } from "@/lib/types";
import type { PresetAvatarId } from "@/lib/viewer-profile";

export const TERALUNE_DEMO_BRAND_ID = "demo-brand-teralune";
export const TERALUNE_DEMO_BRAND_NAME = "Teralune";
export const TERALUNE_GUIDELINES_PDF_URL =
  "/assets/aistudio/Teralune_Brand_Identity_and_AI_Guidelines_034bd417.pdf";
export const TERALUNE_COMPLIANT_AD_PDF_URL =
  "/assets/aistudio/Teralune_100_Percent_Compliant_Advertisement_77d8015e.pdf";
export const TERALUNE_RISKY_AD_PDF_URL =
  "/assets/aistudio/Teralune_0_Percent_Compliance_Test_Advertisement_15326428.pdf";

export type DemoPersona = "Brand Manager" | "Reviewer";

export interface DemoPersonaOption {
  persona: DemoPersona;
  roleTitle: string;
  summary: string;
  avatarId: PresetAvatarId;
}

export const DEMO_PERSONA_OPTIONS: DemoPersonaOption[] = [
  {
    persona: "Brand Manager",
    roleTitle: "Brand Manager",
    summary: "Manage guidelines, assets, and launch readiness",
    avatarId: "mint",
  },
  {
    persona: "Reviewer",
    roleTitle: "Reviewer",
    summary: "Inspect campaigns, verify evidence, and record decisions",
    avatarId: "sky",
  },
];

/**
 * Resolves display-only perspective preference metadata.
 * Non-authoritative: never overwrites viewer identity, customer org permissions, or server auth claims.
 */
export function resolveDemoPersonaConfig(persona?: DemoPersona | string): DemoPersonaOption {
  const found = DEMO_PERSONA_OPTIONS.find((opt) => opt.persona === persona);
  return found ?? DEMO_PERSONA_OPTIONS[0]!;
}

export type TeraluneSampleVariant = "compliant" | "risky" | "guidelines";

export interface TeraluneReviewSampleCard {
  key: "compliant" | "risky";
  label: string;
  subtitle: string;
  buttonLabel: string;
  prefillTitle: string;
  contentType: ContentType;
  tone: "positive" | "warning";
  warningNote?: string;
  fileName: string;
  publicUrl: string;
}

export const TERALUNE_REVIEW_SAMPLE_CARDS: TeraluneReviewSampleCard[] = [
  {
    key: "compliant",
    label: "Compliant campaign",
    subtitle: "Brand-aligned example",
    buttonLabel: "Use Compliant Sample",
    prefillTitle: "Teralune Still Spring Water — Brand-Aligned Campaign",
    contentType: "Campaign Copy",
    tone: "positive",
    fileName: "Teralune_100_Percent_Compliant_Advertisement.pdf",
    publicUrl: TERALUNE_COMPLIANT_AD_PDF_URL,
  },
  {
    key: "risky",
    label: "Risky campaign",
    subtitle: "Brand violations example",
    buttonLabel: "Use Risky Sample",
    prefillTitle: "Teralune Still Spring Water — Compliance Test Advertisement",
    contentType: "Campaign Copy",
    tone: "warning",
    warningNote:
      "This demo advertisement is intentionally designed to trigger guideline conflicts and unverified claim checks when analyzed.",
    fileName: "Teralune_0_Percent_Compliance_Test_Advertisement.pdf",
    publicUrl: TERALUNE_RISKY_AD_PDF_URL,
  },
];

/**
 * Curated Teralune demo fixtures for the Asset Library.
 * Strictly tagged `isDemoFixture: true` so they never mix with customer org data.
 */
export const TERALUNE_CURATED_DEMO_ASSETS: BrandAsset[] = [
  {
    id: "teralune-demo-guidelines-pdf",
    name: "Teralune Brand Identity & AI Guidelines (v1.0)",
    category: "Marketing Assets",
    format: "PDF",
    dimensions: "8 Pages · Source PDF",
    status: "Approved",
    documentUrl: TERALUNE_GUIDELINES_PDF_URL,
    pageCount: 8,
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "mint",
    usageNote:
      "Authoritative Teralune v1.0 governance guide (effective 1 April 2025) defining voice, terminology, claims policy, SKU TLSW-500, MRP ₹25, and visual standards.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-compliant-ad-pdf",
    name: "Teralune Compliant Campaign Advertisement",
    category: "Marketing Assets",
    format: "PDF",
    dimensions: "1 Page · Sample Ad",
    status: "Approved",
    documentUrl: TERALUNE_COMPLIANT_AD_PDF_URL,
    pageCount: 1,
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "blue",
    usageNote:
      "Brand-aligned 500 mL campaign layout using Deep Current #163A52, Spring Teal #239A8B, Teralune™ Still Spring Water naming, and approved CLM-01 to CLM-04 statements.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-risky-ad-pdf",
    name: "Teralune Risky Test Advertisement",
    category: "Marketing Assets",
    format: "PDF",
    dimensions: "1 Page · Stress Test",
    status: "Pending Review",
    documentUrl: TERALUNE_RISKY_AD_PDF_URL,
    pageCount: 1,
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "peach",
    usageNote:
      "High-risk demonstration PDF supplied to illustrate conflicting terminology, unauthorised pricing/marks, and unverified claim handling.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-logo-horizontal",
    name: "Teralune Primary Horizontal Logo",
    category: "Logos",
    format: "SVG",
    dimensions: "Min 120 px / 28 mm",
    status: "Approved",
    previewUrl: "/assets/teralune/logo-horizontal.svg",
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "mint",
    usageNote:
      "LOG-01 to LOG-06: Droplet-and-wave mark paired with TERALUNE™ wordmark on Cloud White #F4F8F7. Never distort, recolour, or use Teralune®.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-droplet-mark",
    name: "Teralune Droplet-and-Wave Symbol Mark",
    category: "Icons & Marks",
    format: "SVG",
    dimensions: "Clear space ≥ height",
    status: "Approved",
    previewUrl: "/assets/teralune/droplet-mark.svg",
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "blue",
    usageNote:
      "Symbol-only mark in Deep Current #163A52 and Spring Teal #239A8B for compact avatars, icons, and bottle cap labels.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-palette-typography",
    name: "Teralune Palette & Typography Sheet",
    category: "Brand Images",
    format: "SVG",
    dimensions: "4 Swatches · v1.0",
    status: "Approved",
    previewUrl: "/assets/teralune/palette-typography.svg",
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "lavender",
    usageNote:
      "Approved colour system (#163A52, #239A8B, #DFF1ED, #F4F8F7), Manrope Bold headings, Inter body copy, and Teralune™ mark rules.",
    updatedAt: "2025-04-01",
  },
  {
    id: "teralune-demo-bottle-reference",
    name: "Teralune™ Still Spring Water 500 mL Reference",
    category: "Brand Images",
    format: "SVG",
    dimensions: "SKU TLSW-500 · Placeholder",
    status: "Approved",
    previewUrl: "/assets/teralune/bottle-reference.svg",
    brandId: TERALUNE_DEMO_BRAND_ID,
    isDemoFixture: true,
    colorTone: "yellow",
    usageNote:
      "Synthetic reference diagram matching SRC-PROD-01: Clear PET bottle, Deep Current cap, white wrap label, 500 mL format, standard MRP ₹25.",
    updatedAt: "2025-04-01",
  },
];

export interface DemoReadinessCheckResult {
  status: "ready" | "attention_needed";
  geminiConfigured: boolean;
  openrouterConfigured: boolean;
  aiProviderReady: boolean;
  supabaseConfigured: boolean;
  serviceRoleConfigured: boolean;
  sampleFilesAvailable: boolean;
  sampleFiles: {
    guidelinesPdf: boolean;
    compliantAdPdf: boolean;
    riskyAdPdf: boolean;
  };
  teraluneBrandReady: boolean;
  publishedRuleCount: number;
  latestPublishedVersion: string | null;
  warnings: string[];
}

export interface CleanSampleFormResetState {
  title: string;
  contentType: ContentType;
  textContent: string;
  errorMessage: string;
  fileError: string;
  assetName: string | undefined;
  assetSizeBytes: number | undefined;
  assetPreviewUrl: string | undefined;
  assetBase64: string | undefined;
  assetMimeType: string | undefined;
  pdfEstimatedPages: number | undefined;
}

/**
 * Pure helper to produce a clean form reset prior to populating a chosen Teralune demo sample.
 */
export function buildCleanResetBeforeSampleLoad(
  sample: TeraluneReviewSampleCard,
): CleanSampleFormResetState {
  return {
    title: sample.prefillTitle,
    contentType: sample.contentType,
    textContent: "",
    errorMessage: "",
    fileError: "",
    assetName: undefined,
    assetSizeBytes: undefined,
    assetPreviewUrl: undefined,
    assetBase64: undefined,
    assetMimeType: undefined,
    pdfEstimatedPages: undefined,
  };
}

/**
 * Keeps curated Teralune demo fixtures isolated from authenticated non-demo customer assets.
 */
export function partitionWorkspaceAssets(
  allAssets: BrandAsset[],
  options: { isDemoWorkspace: boolean },
): {
  demoAssets: BrandAsset[];
  workspaceAssets: BrandAsset[];
} {
  if (!options.isDemoWorkspace) {
    return {
      demoAssets: [],
      workspaceAssets: allAssets.filter((a) => !a.isDemoFixture),
    };
  }
  return {
    demoAssets: allAssets.filter((a) => Boolean(a.isDemoFixture)),
    workspaceAssets: allAssets.filter((a) => !a.isDemoFixture),
  };
}
