import { BrandContextSchema, type BrandContext } from "../contracts";
import {
  BrandKnowledgeRepositoryError,
  type BrandKnowledgeRepository,
} from "./repository";
import {
  BrandKnowledgeRecordSchema,
  type BrandContextQuery,
  type BrandContextWarning,
  type BrandKnowledgeRecord,
} from "./types";

export class InvalidBrandIdError extends Error {
  constructor() {
    super("brandId must be a non-empty string.");
    this.name = "InvalidBrandIdError";
  }
}

export class BrandNotFoundError extends Error {
  public readonly brandId: string;

  constructor(brandId: string) {
    super(`No brand knowledge was found for brandId "${brandId}".`);
    this.name = "BrandNotFoundError";
    this.brandId = brandId;
  }
}

export class InvalidBrandKnowledgeError extends Error {
  public readonly issues: unknown;

  constructor(issues: unknown) {
    super("Retrieved brand knowledge did not match the repository contract.");
    this.name = "InvalidBrandKnowledgeError";
    this.issues = issues;
  }
}

export type BrandContextRetrieval = {
  context: BrandContext;
  warnings: BrandContextWarning[];
  record?: BrandKnowledgeRecord;
};

export class BrandContextService {
  constructor(private readonly repository: BrandKnowledgeRepository) {}

  async getForSubmission(
    query: BrandContextQuery,
  ): Promise<BrandContextRetrieval> {
    const brandId = query.brandId.trim();
    if (!brandId) {
      throw new InvalidBrandIdError();
    }

    let retrieved: BrandKnowledgeRecord | null;
    try {
      retrieved = await this.repository.getBrandKnowledge({
        ...query,
        brandId,
      });
    } catch (error) {
      if (error instanceof BrandKnowledgeRepositoryError) {
        throw error;
      }
      throw new BrandKnowledgeRepositoryError(
        `Failed to retrieve brand knowledge for brandId "${brandId}".`,
        error,
      );
    }

    if (retrieved === null) {
      throw new BrandNotFoundError(brandId);
    }

    const parsed = BrandKnowledgeRecordSchema.safeParse(retrieved);
    if (!parsed.success) {
      throw new InvalidBrandKnowledgeError(parsed.error.issues);
    }

    const applicable = filterApplicableBrandKnowledge(parsed.data, query);
    const mapped = mapToBrandContext(applicable);
    const context = BrandContextSchema.safeParse(mapped);
    if (!context.success) {
      throw new InvalidBrandKnowledgeError(context.error.issues);
    }

    return {
      context: context.data,
      warnings: getWarnings(applicable),
      record: applicable,
    };
  }
}

function isApplicable(
  applicableTo: BrandKnowledgeRecord["guidelines"][number]["applicableTo"],
  query: BrandContextQuery,
): boolean {
  if (!applicableTo) {
    return true;
  }

  const submissionMatches =
    !applicableTo.submissionIds ||
    (query.submissionId !== undefined &&
      applicableTo.submissionIds.includes(query.submissionId));
  const platformMatches =
    !applicableTo.contentPlatforms ||
    (query.contentPlatform !== undefined &&
      applicableTo.contentPlatforms.includes(query.contentPlatform));

  return submissionMatches && platformMatches;
}

export function filterApplicableBrandKnowledge(
  knowledge: BrandKnowledgeRecord,
  query: BrandContextQuery,
): BrandKnowledgeRecord {
  return {
    profile: knowledge.profile,
    guidelines: knowledge.guidelines.filter(
      (item) => item.approved && isApplicable(item.applicableTo, query),
    ),
    productFacts: knowledge.productFacts.filter(
      (item) => item.approved && isApplicable(item.applicableTo, query),
    ),
    promotionalClaims: knowledge.promotionalClaims.filter(
      (item) => item.approved && isApplicable(item.applicableTo, query),
    ),
    terminology: knowledge.terminology.filter(
      (item) => item.approved && isApplicable(item.applicableTo, query),
    ),
    visualAssets: knowledge.visualAssets.filter(
      (item) => item.approved && isApplicable(item.applicableTo, query),
    ),
  };
}

function sourceLabel(
  source: BrandKnowledgeRecord["profile"]["source"],
): string {
  const location = [
    source.pageNumber === undefined ? undefined : `page ${source.pageNumber}`,
    source.section === undefined ? undefined : `section ${source.section}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(", ");
  return `${source.sourceTitle} (${source.sourceDocumentId}; ${source.versionId}${
    location ? `; ${location}` : ""
  })`;
}

function mapToBrandContext(knowledge: BrandKnowledgeRecord): BrandContext {
  const { profile } = knowledge;
  const allSources = [
    profile.source,
    ...knowledge.guidelines.map((item) => item.source),
    ...knowledge.productFacts.map((item) => item.source),
    ...knowledge.promotionalClaims.map((item) => item.source),
    ...knowledge.terminology.map((item) => item.source),
    ...knowledge.visualAssets.map((item) => item.source),
  ];
  const sourceIds = [...new Set(allSources.map((source) => source.sourceDocumentId))];
  const versions = [...new Set(allSources.map((source) => source.versionId))];

  return {
    brandProfile: `${profile.brandName} (${profile.brandId}; organisation ${profile.organisationId}). ${profile.profile} Voice and tone: ${profile.voiceAndTone}`,
    approvedGuidelines: [
      ...profile.communicationInstructions,
      ...profile.designGuidelines,
      ...profile.usagePolicies,
      ...knowledge.guidelines.map(
        (item) => `${item.value} [Source: ${sourceLabel(item.source)}]`,
      ),
    ],
    approvedProductFacts: knowledge.productFacts.map(
      (item) => `${item.kind}: ${item.value} [Source: ${sourceLabel(item.source)}]`,
    ),
    approvedPromotionalClaims: knowledge.promotionalClaims.map(
      (item) =>
        `${item.value} Supporting evidence: ${item.supportingEvidence}. Restrictions: ${
          item.restrictions.join("; ") || "None recorded"
        } [Source: ${sourceLabel(item.source)}]`,
    ),
    preferredTerminology: knowledge.terminology
      .filter((item) => item.kind === "PREFERRED" || item.kind === "SPELLING")
      .map((item) => `${item.kind}: ${item.value} [Source: ${sourceLabel(item.source)}]`),
    prohibitedTerminology: knowledge.terminology
      .filter((item) => item.kind === "PROHIBITED")
      .map((item) => `${item.value} [Source: ${sourceLabel(item.source)}]`),
    approvedColours: [
      ...profile.approvedColours,
      ...knowledge.visualAssets
        .filter((item) => item.kind === "COLOUR")
        .map((item) => `${item.value} [Source: ${sourceLabel(item.source)}]`),
    ],
    approvedVisualAssetReferences: [
      ...profile.approvedLogoReferences,
      ...profile.typographyReferences,
      ...profile.assetMetadata,
      ...knowledge.visualAssets
        .filter((item) => item.kind !== "COLOUR")
        .map((item) => `${item.kind}: ${item.value} [Source: ${sourceLabel(item.source)}]`),
    ],
    sourceIds,
    versionId: versions.join(", "),
    sourceVersionInformation: allSources
      .map((source) => sourceLabel(source))
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" | "),
  };
}

function getWarnings(knowledge: BrandKnowledgeRecord): BrandContextWarning[] {
  const warnings: BrandContextWarning[] = [];
  if (knowledge.guidelines.length === 0) {
    warnings.push("NO_APPROVED_GUIDELINES");
  }
  if (knowledge.productFacts.length === 0) {
    warnings.push("NO_APPROVED_PRODUCT_FACTS");
  }
  if (knowledge.promotionalClaims.length === 0) {
    warnings.push("NO_APPROVED_PROMOTIONAL_CLAIMS");
  }
  if (knowledge.terminology.length === 0) {
    warnings.push("NO_APPROVED_TERMINOLOGY");
  }
  if (knowledge.visualAssets.length === 0) {
    warnings.push("NO_APPROVED_VISUAL_ASSETS");
  }
  if (
    knowledge.guidelines.length === 0 &&
    knowledge.productFacts.length === 0 &&
    knowledge.promotionalClaims.length === 0 &&
    knowledge.terminology.length === 0 &&
    knowledge.visualAssets.length === 0
  ) {
    warnings.push("NO_PUBLISHED_KNOWLEDGE");
  }
  return warnings;
}
