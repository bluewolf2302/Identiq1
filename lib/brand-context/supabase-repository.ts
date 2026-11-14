
import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { BrandKnowledgeRecordSchema } from "./types";
import type {
  BrandContextQuery,
  BrandKnowledgeRecord,
  BrandProfileRecord,
} from "./types";
import type { BrandKnowledgeRepository } from "./repository";
import { teraluneKnowledge } from "./teralune-brand-fixture";

function sourceMetadata(row: any) {
  return {
    sourceDocumentId: row.source_document_id,
    sourceTitle: row.source_title,
    versionId: row.version_id,
    ...(row.page_number != null
      ? { pageNumber: row.page_number }
      : {}),
    ...(row.section
      ? { section: row.section }
      : {}),
  };
}

function applicability(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return {
    ...(Array.isArray(value.submissionIds)
      ? { submissionIds: value.submissionIds }
      : {}),
    ...(Array.isArray(value.contentPlatforms)
      ? { contentPlatforms: value.contentPlatforms }
      : {}),
  };
}

function baseRecord(row: any) {
  const applicableTo = applicability(row.applicable_to);

  return {
    approved: true as const,
    source: sourceMetadata(row),
    ...(applicableTo ? { applicableTo } : {}),
  };
}

function getFactKind(category: string, factName: string) {
  switch (category) {
    case "PRODUCT_NAME":
      return "PRODUCT_NAME";
    case "PRODUCT_PRICE":
      return "PRODUCT_PRICE";
    case "PRODUCT_SPECIFICATION":
      return "PRODUCT_SPECIFICATION";
    case "COMPANY_INFORMATION":
      return "COMPANY_INFORMATION";
    case "TERMINOLOGY_PREFERRED":
      return "PREFERRED";
    case "TERMINOLOGY_PROHIBITED":
      return "PROHIBITED";
    case "SPELLING":
      return "SPELLING";
    case "COLOUR":
      return "COLOUR";
    case "TYPOGRAPHY":
      return "TYPOGRAPHY";
    case "LOGO":
      return "LOGO";
    case "ASSET_METADATA":
      return "ASSET_METADATA";
    default:
      if (factName.startsWith("TERM-PREFERRED")) {
        return "PREFERRED";
      }
      if (factName.startsWith("TERM-PROHIBITED")) {
        return "PROHIBITED";
      }
      return null;
  }
}

export class SupabaseBrandKnowledgeRepository
  implements BrandKnowledgeRepository
{
  async getBrandKnowledge(
    query: BrandContextQuery,
  ): Promise<BrandKnowledgeRecord | null> {
    if (!query.brandId?.trim()) {
      return null;
    }

    const { data: brand, error: brandError } = await supabaseServer
      .from("brands")
      .select("*")
      .eq("id", query.brandId)
      .eq("approved", true)
      .maybeSingle();

    if (brandError) {
      throw new Error(
        `Could not fetch approved brand: ${brandError.message}`,
      );
    }

    if (!brand) {
      return null;
    }

    const [rulesResult, factsResult] = await Promise.all([
      supabaseServer
        .from("brand_rules")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("approved", true),

      supabaseServer
        .from("brand_facts")
        .select("*")
        .eq("brand_id", brand.id)
        .eq("approved", true),
    ]);

    if (rulesResult.error) {
      throw new Error(
        `Could not fetch brand rules: ${rulesResult.error.message}`,
      );
    }

    if (factsResult.error) {
      throw new Error(
        `Could not fetch brand facts: ${factsResult.error.message}`,
      );
    }

    const rules = rulesResult.data ?? [];
    const facts = factsResult.data ?? [];

    const profile: BrandProfileRecord = {
      approved: true,
      brandId: brand.id,
      organisationId: brand.organisation_id,
      brandName: brand.name,
      profile: brand.profile,
      voiceAndTone: brand.voice_and_tone,
      communicationInstructions:
        brand.communication_instructions ?? [],
      designGuidelines: brand.design_guidelines ?? [],
      usagePolicies: brand.usage_policies ?? [],
      approvedColours: brand.approved_colours ?? [],
      typographyReferences: brand.typography_references ?? [],
      approvedLogoReferences:
        brand.approved_logo_references ?? [],
      assetMetadata: brand.asset_metadata ?? [],
      source: {
        sourceDocumentId: brand.source_document_id,
        sourceTitle: brand.source_title,
        versionId: brand.version_id,
        ...(brand.page_number != null
          ? { pageNumber: brand.page_number }
          : {}),
        ...(brand.section
          ? { section: brand.section }
          : {}),
      },
    };

    // Map approved brand rules.
    const guidelines = rules.map((row: any) => ({
      ...baseRecord(row),
      kind: row.category,
      value: row.description,
    }));

    // Map approved product and company facts.
    const productFacts = facts
      .filter((row: any) =>
        [
          "PRODUCT_NAME",
          "PRODUCT_PRICE",
          "PRODUCT_SPECIFICATION",
          "COMPANY_INFORMATION",
        ].includes(row.category),
      )
      .map((row: any) => ({
        ...baseRecord(row),
        kind: getFactKind(row.category, row.fact_name),
        value: row.fact_value,
      }))
      .filter((row: any) => row.kind !== null);

    // Map approved promotional claims.
    const promotionalClaims = facts
      .filter(
        (row: any) => row.category === "PROMOTIONAL_CLAIM",
      )
      .map((row: any) => ({
        ...baseRecord(row),
        value: row.fact_value,
        supportingEvidence:
          row.supporting_evidence ??
          row.source ??
          "Evidence reference unavailable",
        restrictions: Array.isArray(row.restrictions)
          ? row.restrictions
          : [],
      }));

    // Map preferred, prohibited and spelling terminology.
    const terminology = facts
      .filter((row: any) =>
        [
          "TERMINOLOGY_PREFERRED",
          "TERMINOLOGY_PROHIBITED",
          "SPELLING",
        ].includes(row.category),
      )
      .map((row: any) => ({
        ...baseRecord(row),
        kind: getFactKind(row.category, row.fact_name),
        value: row.fact_value,
      }))
      .filter((row: any) => row.kind !== null);

    // Map approved visual assets.
    const visualAssets = facts
      .filter((row: any) =>
        [
          "COLOUR",
          "TYPOGRAPHY",
          "LOGO",
          "ASSET_METADATA",
        ].includes(row.category),
      )
      .map((row: any) => ({
        ...baseRecord(row),
        kind: getFactKind(row.category, row.fact_name),
        value: row.fact_value,
      }))
      .filter((row: any) => row.kind !== null);

    const result = {
      profile,
      guidelines,
      productFacts,
      promotionalClaims,
      terminology,
      visualAssets,
    };

    return BrandKnowledgeRecordSchema.parse(result);
  }
}

export async function syncTeraluneProfile() {
  const profile = teraluneKnowledge.profile;

  const { data: organisation, error: organisationError } =
    await supabaseServer
      .from("organisations")
      .select("id")
      .eq("name", "Teralune Demo Organisation")
      .single();

  if (organisationError) {
    throw new Error(
      `Could not find Teralune organisation: ${organisationError.message}`,
    );
  }

  const { data: brand, error: lookupError } =
    await supabaseServer
      .from("brands")
      .select("id, organisation_id")
      .eq("name", profile.brandName)
      .eq("organisation_id", organisation.id)
      .single();

  if (lookupError) {
    throw new Error(
      `Could not find Teralune brand: ${lookupError.message}`,
    );
  }

  const { error: updateError } = await supabaseServer
    .from("brands")
    .update({
      approved: profile.approved,
      profile: profile.profile,
      voice_and_tone: profile.voiceAndTone,
      communication_instructions:
        profile.communicationInstructions,
      design_guidelines: profile.designGuidelines,
      usage_policies: profile.usagePolicies,
      approved_colours: profile.approvedColours,
      typography_references: profile.typographyReferences,
      approved_logo_references:
        profile.approvedLogoReferences,
      asset_metadata: profile.assetMetadata,
      source_document_id: profile.source.sourceDocumentId,
      source_title: profile.source.sourceTitle,
      version_id: profile.source.versionId,
      page_number: profile.source.pageNumber ?? null,
      section: profile.source.section ?? null,
    })
    .eq("id", brand.id)
    .eq("organisation_id", organisation.id);

  if (updateError) {
    throw new Error(
      `Could not update Teralune profile: ${updateError.message}`,
    );
  }

  return {
    success: true,
    brandId: brand.id,
  };
}

