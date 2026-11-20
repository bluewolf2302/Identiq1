import { z } from "zod";

const SourceMetadataSchema = z
  .object({
    sourceDocumentId: z.string().trim().min(1),
    sourceTitle: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
    pageNumber: z.number().int().positive().optional(),
    section: z.string().trim().min(1).optional(),
  })
  .strict();

const ApplicabilitySchema = z
  .object({
    submissionIds: z.array(z.string().trim().min(1)).optional(),
    contentPlatforms: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const ApprovedRecordSchema = z
  .object({
    approved: z.literal(true),
    applicableTo: ApplicabilitySchema.optional(),
    source: SourceMetadataSchema,
  })
  .strict();

export const BrandProfileRecordSchema = ApprovedRecordSchema.extend({
  brandId: z.string().trim().min(1),
  organisationId: z.string().trim().min(1),
  brandName: z.string().trim().min(1),
  profile: z.string().trim().min(1),
  voiceAndTone: z.string().trim().min(1),
  communicationInstructions: z.array(z.string().trim().min(1)),
  designGuidelines: z.array(z.string().trim().min(1)),
  usagePolicies: z.array(z.string().trim().min(1)),
  approvedColours: z.array(z.string().trim().min(1)),
  typographyReferences: z.array(z.string().trim().min(1)),
  approvedLogoReferences: z.array(z.string().trim().min(1)),
  assetMetadata: z.array(z.string().trim().min(1)),
});

export type BrandProfileRecord = z.infer<typeof BrandProfileRecordSchema>;

const KnowledgeRecordSchema = ApprovedRecordSchema.extend({
  value: z.string().trim().min(1),
});

export const BrandKnowledgeRecordSchema = z
  .object({
    profile: BrandProfileRecordSchema,
    guidelines: z.array(
      KnowledgeRecordSchema.extend({
        kind: z.enum(["VOICE_AND_TONE", "COMMUNICATION", "DESIGN", "USAGE"]),
      }),
    ),
    productFacts: z.array(
      KnowledgeRecordSchema.extend({
        kind: z.enum([
          "PRODUCT_NAME",
          "PRODUCT_PRICE",
          "PRODUCT_SPECIFICATION",
          "APPROVED_DATE",
          "COMPANY_INFORMATION",
        ]),
      }),
    ),
    promotionalClaims: z.array(
      KnowledgeRecordSchema.extend({
        supportingEvidence: z.string().trim().min(1),
        restrictions: z.array(z.string().trim().min(1)),
      }),
    ),
    terminology: z.array(
      KnowledgeRecordSchema.extend({
        kind: z.enum(["PREFERRED", "PROHIBITED", "SPELLING"]),
      }),
    ),
    visualAssets: z.array(
      KnowledgeRecordSchema.extend({
        kind: z.enum(["COLOUR", "TYPOGRAPHY", "LOGO", "ASSET_METADATA"]),
      }),
    ),
  })
  .strict();

export type BrandKnowledgeRecord = z.infer<typeof BrandKnowledgeRecordSchema>;

export const PublicationStatusSchema = z.enum([
  "draft",
  "published",
  "archived",
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const ManagedKnowledgeSectionSchema = z.enum([
  "guidelines",
  "facts",
  "terminology",
  "prohibited",
  "voice",
  "visual",
  "policies",
]);
export type ManagedKnowledgeSection = z.infer<
  typeof ManagedKnowledgeSectionSchema
>;

export const ManagedKnowledgeEntrySchema = z
  .object({
    id: z.string().trim().min(1),
    brandId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1),
    section: ManagedKnowledgeSectionSchema,
    kind: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    content: z.string().trim().min(1),
    preferredTerm: z.string().trim().min(1).optional(),
    avoidTerm: z.string().trim().min(1).optional(),
    hexCodes: z.array(z.string().trim().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
    fontFamily: z.string().trim().min(1).optional(),
    supportingEvidence: z.string().trim().min(1).optional(),
    restrictions: z.array(z.string().trim().min(1)).optional(),
    severity: z.enum(["high", "medium", "low"]).optional(),
    publicationStatus: PublicationStatusSchema,
    versionNumber: z.number().int().positive(),
    versionId: z.string().trim().min(1),
    sourceDocumentId: z.string().trim().min(1),
    sourceTitle: z.string().trim().min(1),
    sectionRef: z.string().trim().min(1).optional(),
    pageNumber: z.number().int().positive().optional(),
    applicableTo: ApplicabilitySchema.optional(),
    owner: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    publishedAt: z.string().trim().min(1).optional(),
    archivedAt: z.string().trim().min(1).optional(),
  })
  .strict();

export type ManagedKnowledgeEntry = z.infer<typeof ManagedKnowledgeEntrySchema>;

export const WorkspaceBrandRecordSchema = z
  .object({
    brandId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1),
    brandName: z.string().trim().min(1),
    description: z.string().trim().optional(),
    website: z.string().trim().optional(),
    approved: z.boolean(),
    isSample: z.boolean().optional(),
    profileSummary: z.string().trim().optional(),
    voiceAndToneSummary: z.string().trim().optional(),
    latestPublishedVersion: z.string().trim().min(1).optional(),
    publishedEntryCount: z.number().int().nonnegative(),
    draftEntryCount: z.number().int().nonnegative(),
    archivedEntryCount: z.number().int().nonnegative(),
    updatedAt: z.string().trim().min(1),
  })
  .strict();

export type WorkspaceBrandRecord = z.infer<typeof WorkspaceBrandRecordSchema>;

export const BrandVersionSnapshotSchema = z
  .object({
    snapshotId: z.string().trim().min(1),
    brandId: z.string().trim().min(1),
    organisationId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
    versionNumber: z.number().int().positive(),
    publishedAt: z.string().trim().min(1),
    publishedBy: z.string().trim().min(1),
    note: z.string().trim().optional(),
    entries: z.array(ManagedKnowledgeEntrySchema),
  })
  .strict();

export type BrandVersionSnapshot = z.infer<typeof BrandVersionSnapshotSchema>;

export type BrandContextQuery = {
  brandId: string;
  organisationId?: string;
  versionId?: string;
  submissionId?: string;
  contentPlatform?: string;
};

export type BrandContextWarning =
  | "NO_APPROVED_GUIDELINES"
  | "NO_APPROVED_PRODUCT_FACTS"
  | "NO_APPROVED_PROMOTIONAL_CLAIMS"
  | "NO_APPROVED_TERMINOLOGY"
  | "NO_APPROVED_VISUAL_ASSETS"
  | "NO_PUBLISHED_KNOWLEDGE";
