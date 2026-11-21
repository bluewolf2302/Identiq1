import { teraluneKnowledge } from "./teralune-brand-fixture";
import type {
  BrandKnowledgeRecord,
  ManagedKnowledgeEntry,
  WorkspaceBrandRecord,
} from "./types";

function splitTerms(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractHexCodesFromText(text: string): string[] {
  const matches = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  return [...new Set(matches.map((hex) => hex.toUpperCase()))];
}

function extractHexLabel(
  hex: string,
  content: string,
  fallbackTitle: string,
): string {
  const escaped = hex.replace("#", "\\#");
  const pattern = new RegExp(`([A-Za-z0-9][A-Za-z0-9\\s-]{1,40})\\s+${escaped}`, "i");
  const match = content.match(pattern);
  const candidate = match?.[1]?.trim();
  if (candidate) {
    return `${candidate} ${hex}`;
  }
  const cleanTitle = fallbackTitle.replace(/[^A-Za-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  return cleanTitle ? `${cleanTitle} ${hex}` : hex;
}

function inferProductFactKind(
  entry: ManagedKnowledgeEntry,
): BrandKnowledgeRecord["productFacts"][number]["kind"] {
  if (
    entry.kind === "PRODUCT_NAME" ||
    entry.kind === "PRODUCT_PRICE" ||
    entry.kind === "PRODUCT_SPECIFICATION" ||
    entry.kind === "APPROVED_DATE" ||
    entry.kind === "COMPANY_INFORMATION"
  ) {
    return entry.kind;
  }
  const combined = `${entry.title} ${entry.content}`;
  if (/^PRODUCT_PRICE\s*:|price|pricing|msrp|\$\d|₹\d|€\d|£\d/i.test(combined)) {
    return "PRODUCT_PRICE";
  }
  if (/^APPROVED_DATE\s*:|launch date|release date|effective date/i.test(combined)) {
    return "APPROVED_DATE";
  }
  if (/company|headquarters|founded|inc\.|ltd\.|private limited/i.test(combined)) {
    return "COMPANY_INFORMATION";
  }
  if (/product name|official name|sku|brand name/i.test(combined)) {
    return "PRODUCT_NAME";
  }
  return "PRODUCT_SPECIFICATION";
}

function inferGuidelineKind(
  entry: ManagedKnowledgeEntry,
): BrandKnowledgeRecord["guidelines"][number]["kind"] {
  if (
    entry.kind === "VOICE_AND_TONE" ||
    entry.kind === "COMMUNICATION" ||
    entry.kind === "DESIGN" ||
    entry.kind === "USAGE"
  ) {
    return entry.kind;
  }
  if (entry.section === "voice") return "VOICE_AND_TONE";
  if (entry.section === "policies") return "USAGE";
  const combined = `${entry.title} ${entry.content}`;
  if (/logo|colour|color|typography|font|layout|clear\s*space|visual/i.test(combined)) {
    return "DESIGN";
  }
  return "COMMUNICATION";
}

function entrySource(entry: ManagedKnowledgeEntry) {
  return {
    sourceDocumentId: entry.sourceDocumentId,
    sourceTitle: entry.sourceTitle,
    versionId: entry.versionId,
    ...(entry.pageNumber ? { pageNumber: entry.pageNumber } : {}),
    ...(entry.sectionRef ? { section: entry.sectionRef } : {}),
  };
}

/**
 * Converts a WorkspaceBrandRecord and its active entries into the canonical
 * BrandKnowledgeRecord expected by BrandContextService and VisualAnalysisAdapter.
 *
 * Strictly filters to published entries only (unless historical snapshot entries
 * explicitly reconstructed from an immutable published snapshot are supplied).
 */
export function buildBrandKnowledgeRecordFromEntries(
  brand: WorkspaceBrandRecord,
  allEntries: ManagedKnowledgeEntry[],
  options: { allowSnapshotEntries?: boolean; overrideVersionId?: string } = {},
): BrandKnowledgeRecord {
  const publishedEntries = options.allowSnapshotEntries
    ? allEntries
    : allEntries.filter((entry) => entry.publicationStatus === "published");

  const guidelines: BrandKnowledgeRecord["guidelines"] = [];
  const productFacts: BrandKnowledgeRecord["productFacts"] = [];
  const promotionalClaims: BrandKnowledgeRecord["promotionalClaims"] = [];
  const terminology: BrandKnowledgeRecord["terminology"] = [];
  const visualAssets: BrandKnowledgeRecord["visualAssets"] = [];

  const communicationInstructions: string[] = [];
  const designGuidelines: string[] = [];
  const usagePolicies: string[] = [];
  const approvedColours: string[] = [];
  const typographyReferences: string[] = [];
  const approvedLogoReferences: string[] = [];
  const assetMetadata: string[] = [];
  const voiceParts: string[] = [];

  const seenColours = new Set<string>();

  for (const entry of publishedEntries) {
    const source = entrySource(entry);
    const applicableTo = entry.applicableTo;

    switch (entry.section) {
      case "voice": {
        voiceParts.push(`${entry.title}: ${entry.content}`);
        guidelines.push({
          approved: true,
          kind: "VOICE_AND_TONE",
          value: `${entry.title}: ${entry.content}`,
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        break;
      }

      case "guidelines": {
        const gKind = inferGuidelineKind(entry);
        const value = `${entry.title}: ${entry.content}`;
        guidelines.push({
          approved: true,
          kind: gKind,
          value,
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        if (gKind === "DESIGN") {
          designGuidelines.push(value);
        } else if (gKind === "USAGE") {
          usagePolicies.push(value);
        } else {
          communicationInstructions.push(value);
        }
        break;
      }

      case "policies": {
        const value = `${entry.title}: ${entry.content}`;
        usagePolicies.push(value);
        guidelines.push({
          approved: true,
          kind: "USAGE",
          value,
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        break;
      }

      case "facts": {
        const fKind = inferProductFactKind(entry);
        const rawValue = entry.content.trim();
        const cleanedValue =
          fKind === "PRODUCT_PRICE" && /^PRODUCT_PRICE\s*:/i.test(rawValue)
            ? rawValue.replace(/^PRODUCT_PRICE\s*:\s*/i, "").trim()
            : fKind === "APPROVED_DATE" && /^APPROVED_DATE\s*:/i.test(rawValue)
              ? rawValue.replace(/^APPROVED_DATE\s*:\s*/i, "").trim()
              : rawValue.includes(entry.title)
                ? rawValue
                : `${entry.title}: ${rawValue}`;
        productFacts.push({
          approved: true,
          kind: fKind,
          value: cleanedValue,
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        if (entry.supportingEvidence || /claim|tagline|headline|substantiat/i.test(entry.title)) {
          promotionalClaims.push({
            approved: true,
            value: `${entry.title}: ${rawValue}`,
            supportingEvidence: entry.supportingEvidence ?? entry.sourceTitle,
            restrictions: entry.restrictions ?? [],
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        }
        break;
      }

      case "terminology": {
        const isRequired =
          entry.kind === "REQUIRED" || /\bREQUIRED\s*:/i.test(`${entry.title} ${entry.content}`);
        if (entry.preferredTerm) {
          const val = isRequired
            ? `REQUIRED: ${entry.preferredTerm}`
            : `${entry.preferredTerm} (${entry.title}: ${entry.content})`;
          terminology.push({
            approved: true,
            kind: "PREFERRED",
            value: val,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        } else {
          terminology.push({
            approved: true,
            kind: "PREFERRED",
            value: `${entry.title}: ${entry.content}`,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        }

        for (const avoided of splitTerms(entry.avoidTerm)) {
          terminology.push({
            approved: true,
            kind: "PROHIBITED",
            value: avoided,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        }
        break;
      }

      case "prohibited": {
        const value = `${entry.title}: ${entry.content}`;
        usagePolicies.push(value);
        guidelines.push({
          approved: true,
          kind: "USAGE",
          value,
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        const avoidedList = splitTerms(entry.avoidTerm);
        for (const avoided of avoidedList) {
          terminology.push({
            approved: true,
            kind: "PROHIBITED",
            value: avoided,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        }
        promotionalClaims.push({
          approved: true,
          value:
            avoidedList.length === 1
              ? `PROHIBITED: ${avoidedList[0]}`
              : `Restricted claim boundary (${entry.title}): ${entry.content}`,
          supportingEvidence: entry.supportingEvidence ?? entry.sourceTitle,
          restrictions:
            entry.restrictions && entry.restrictions.length > 0
              ? entry.restrictions
              : [entry.content],
          source,
          ...(applicableTo ? { applicableTo } : {}),
        });
        break;
      }

      case "visual": {
        const hexes = [
          ...(entry.hexCodes ?? []),
          ...extractHexCodesFromText(entry.content),
        ].map((h) => h.toUpperCase());
        const uniqueHexes = [...new Set(hexes)];

        for (const hex of uniqueHexes) {
          if (!seenColours.has(hex)) {
            seenColours.add(hex);
            const labelled = extractHexLabel(hex, entry.content, entry.title);
            approvedColours.push(labelled);
            visualAssets.push({
              approved: true,
              kind: "COLOUR",
              value: labelled,
              source,
              ...(applicableTo ? { applicableTo } : {}),
            });
          }
        }

        if (entry.fontFamily) {
          typographyReferences.push(entry.fontFamily);
          visualAssets.push({
            approved: true,
            kind: "TYPOGRAPHY",
            value: entry.fontFamily,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        }

        const isLogo = /logo|wordmark|emblem|droplet|mark|lockup/i.test(
          `${entry.title} ${entry.content}`,
        );
        const visualDescription = `${entry.title}: ${entry.content}`;
        designGuidelines.push(visualDescription);
        if (isLogo) {
          approvedLogoReferences.push(visualDescription);
          visualAssets.push({
            approved: true,
            kind: "LOGO",
            value: visualDescription,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        } else if (uniqueHexes.length === 0 && !entry.fontFamily) {
          assetMetadata.push(visualDescription);
          visualAssets.push({
            approved: true,
            kind: "ASSET_METADATA",
            value: visualDescription,
            source,
            ...(applicableTo ? { applicableTo } : {}),
          });
        } else {
          assetMetadata.push(visualDescription);
        }
        break;
      }
    }
  }

  const primaryPublished = publishedEntries[0];
  const latestVersion =
    options.overrideVersionId ??
    brand.latestPublishedVersion ??
    primaryPublished?.versionId ??
    "v0";

  return {
    profile: {
      approved: true,
      brandId: brand.brandId,
      organisationId: brand.organisationId,
      brandName: brand.brandName,
      profile:
        brand.profileSummary ||
        brand.description ||
        `${brand.brandName} brand governance profile.`,
      voiceAndTone:
        voiceParts.join(" ") ||
        brand.voiceAndToneSummary ||
        "No published voice and tone standard recorded yet.",
      communicationInstructions,
      designGuidelines,
      usagePolicies,
      approvedColours,
      typographyReferences,
      approvedLogoReferences,
      assetMetadata,
      source: primaryPublished
        ? entrySource(primaryPublished)
        : {
            sourceDocumentId: `brand-${brand.brandId}`,
            sourceTitle: `${brand.brandName} Brand Profile`,
            versionId: latestVersion,
            section: "Brand Profile",
          },
    },
    guidelines,
    productFacts,
    promotionalClaims,
    terminology,
    visualAssets,
  };
}

/**
 * Converts the Teralune demo fixture into ManagedKnowledgeEntry rows so the
 * explicit sample brand can be inspected in Knowledge Hub without mixing with
 * customer brands.
 */
export function buildTeraluneSampleSeed(): {
  brand: WorkspaceBrandRecord;
  entries: ManagedKnowledgeEntry[];
} {
  const brandId = teraluneKnowledge.profile.brandId;
  const organisationId = teraluneKnowledge.profile.organisationId;
  const now = "2026-11-01T00:00:00.000Z";
  const entries: ManagedKnowledgeEntry[] = [];

  teraluneKnowledge.guidelines.forEach((g, idx) => {
    const section =
      g.kind === "VOICE_AND_TONE"
        ? "voice"
        : g.kind === "USAGE"
          ? "policies"
          : "guidelines";
    entries.push({
      id: `teralune-gl-${idx + 1}`,
      brandId,
      organisationId,
      section,
      kind: g.kind,
      title: `Teralune ${g.kind.replace(/_/g, " ")} Rule #${idx + 1}`,
      content: g.value,
      publicationStatus: "published",
      versionNumber: 1,
      versionId: g.source.versionId,
      sourceDocumentId: g.source.sourceDocumentId,
      sourceTitle: g.source.sourceTitle,
      sectionRef: g.source.section,
      pageNumber: g.source.pageNumber,
      owner: "Teralune Governance Fixture",
      updatedAt: now,
      publishedAt: now,
    });
  });

  teraluneKnowledge.productFacts.forEach((f, idx) => {
    entries.push({
      id: `teralune-fact-${idx + 1}`,
      brandId,
      organisationId,
      section: "facts",
      kind: f.kind,
      title: `Teralune ${f.kind.replace(/_/g, " ")}`,
      content: f.value,
      publicationStatus: "published",
      versionNumber: 1,
      versionId: f.source.versionId,
      sourceDocumentId: f.source.sourceDocumentId,
      sourceTitle: f.source.sourceTitle,
      sectionRef: f.source.section,
      pageNumber: f.source.pageNumber,
      owner: "Teralune Governance Fixture",
      updatedAt: now,
      publishedAt: now,
    });
  });

  teraluneKnowledge.promotionalClaims.forEach((c, idx) => {
    entries.push({
      id: `teralune-claim-${idx + 1}`,
      brandId,
      organisationId,
      section: "facts",
      kind: "PROMOTIONAL_CLAIM",
      title: `Approved Claim #${idx + 1}`,
      content: c.value,
      supportingEvidence: c.supportingEvidence,
      restrictions: [...c.restrictions],
      publicationStatus: "published",
      versionNumber: 1,
      versionId: c.source.versionId,
      sourceDocumentId: c.source.sourceDocumentId,
      sourceTitle: c.source.sourceTitle,
      sectionRef: c.source.section,
      pageNumber: c.source.pageNumber,
      owner: "Teralune Governance Fixture",
      updatedAt: now,
      publishedAt: now,
    });
  });

  teraluneKnowledge.terminology.forEach((t, idx) => {
    const isProhibited = t.kind === "PROHIBITED";
    entries.push({
      id: `teralune-term-${idx + 1}`,
      brandId,
      organisationId,
      section: isProhibited ? "prohibited" : "terminology",
      kind: isProhibited ? "PROHIBITED" : "REQUIRED",
      title: isProhibited
        ? `Prohibited Term: ${t.value}`
        : `Required Terminology #${idx + 1}`,
      content: isProhibited
        ? `Do not use "${t.value}" in Teralune communications.`
        : t.value,
      ...(isProhibited
        ? { avoidTerm: t.value }
        : { preferredTerm: t.value.replace(/^REQUIRED\s*:\s*/i, "") }),
      publicationStatus: "published",
      versionNumber: 1,
      versionId: t.source.versionId,
      sourceDocumentId: t.source.sourceDocumentId,
      sourceTitle: t.source.sourceTitle,
      sectionRef: t.source.section,
      pageNumber: t.source.pageNumber,
      owner: "Teralune Governance Fixture",
      updatedAt: now,
      publishedAt: now,
    });
  });

  entries.push({
    id: "teralune-visual-palette-1",
    brandId,
    organisationId,
    section: "visual",
    kind: "COLOUR",
    title: "Teralune Approved Colour Palette",
    content: teraluneKnowledge.profile.approvedColours.join(", "),
    hexCodes: ["#163A52", "#239A8B", "#DFF1ED", "#F4F8F7"],
    fontFamily: teraluneKnowledge.profile.typographyReferences.join(" / "),
    publicationStatus: "published",
    versionNumber: 1,
    versionId: "1.0",
    sourceDocumentId: "SRC-ASSET-01",
    sourceTitle: "Teralune Approved Logo and Product Appearance (fictional)",
    sectionRef: "Visual identity and asset standards, page 2",
    pageNumber: 2,
    owner: "Teralune Governance Fixture",
    updatedAt: now,
    publishedAt: now,
  });

  entries.push({
    id: "teralune-visual-logo-1",
    brandId,
    organisationId,
    section: "visual",
    kind: "LOGO",
    title: "Teralune Droplet-and-Wave Logo & Clearspace",
    content: teraluneKnowledge.profile.designGuidelines.slice(1).join(" "),
    publicationStatus: "published",
    versionNumber: 1,
    versionId: "1.0",
    sourceDocumentId: "SRC-ASSET-01",
    sourceTitle: "Teralune Approved Logo and Product Appearance (fictional)",
    sectionRef: "Visual identity and asset standards, page 2",
    pageNumber: 2,
    owner: "Teralune Governance Fixture",
    updatedAt: now,
    publishedAt: now,
  });

  const brand: WorkspaceBrandRecord = {
    brandId,
    organisationId,
    brandName: "Teralune (Demo Sample)",
    description: teraluneKnowledge.profile.profile,
    approved: true,
    isSample: true,
    profileSummary: teraluneKnowledge.profile.profile,
    voiceAndToneSummary: teraluneKnowledge.profile.voiceAndTone,
    latestPublishedVersion: "1.0",
    publishedEntryCount: entries.length,
    draftEntryCount: 0,
    archivedEntryCount: 0,
    updatedAt: now,
  };

  return { brand, entries };
}
