import type { BrandKnowledgeRecord } from "../brand-context/types";
import type { BrandContext } from "../contracts";
import type {
  ApprovedColorSpec,
  ApprovedLogoRule,
  ApprovedVisualRule,
  BrandVisualContext,
} from "./types";

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return null;
  }
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

/**
 * Converts sRGB [0..255] to CIE L*a*b* (D65 illuminant) for perceptual CIEDE2000 comparison.
 */
export function rgbToLab(rgb: { r: number; g: number; b: number }): {
  l: number;
  a: number;
  b: number;
} {
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  // sRGB D65 matrix
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function parseColorSpecFromString(
  raw: string,
  sourceMeta: {
    sourceId: string;
    sourceVersion: string;
    sourceTitle: string;
    pageNumber?: number;
  },
): ApprovedColorSpec[] {
  const cleanText = raw.split(/\s+\[Source:/i, 1)[0]?.trim() ?? raw;
  const hexMatches = [...cleanText.matchAll(/([A-Za-z0-9\s-]*?)\s*(#[0-9a-fA-F]{6})\b/g)];
  const specs: ApprovedColorSpec[] = [];

  for (const match of hexMatches) {
    const hex = match[2]!.toUpperCase();
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const rawName = (match[1] ?? "").replace(/[:;,-]+$/, "").trim();
    specs.push({
      name: rawName || hex,
      hex,
      rgb,
      lab: rgbToLab(rgb),
      sourceId: sourceMeta.sourceId,
      sourceVersion: sourceMeta.sourceVersion,
      sourceTitle: sourceMeta.sourceTitle,
      pageNumber: sourceMeta.pageNumber,
      excerpt: cleanText,
    });
  }
  return specs;
}

function extractRuleId(text: string): string | null {
  const match = text.match(/\b((?:LOG|IMG|TM|CP|PRD|CLM|LANG)-\d{2})\b/i);
  return match ? match[1]!.toUpperCase() : null;
}

function parseSourceFromBracket(
  text: string,
  fallbackSourceId: string,
  fallbackVersion: string,
  fallbackTitle: string,
): {
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  pageNumber?: number;
} {
  const match = text.match(/\[Source:\s*(.+?)\s*\(([^;)]+);\s*([^;)]+)(?:;\s*page\s*(\d+))?[^)]*\)\]/i);
  if (!match) {
    return {
      sourceId: fallbackSourceId,
      sourceVersion: fallbackVersion,
      sourceTitle: fallbackTitle,
    };
  }
  return {
    sourceTitle: match[1]!.trim(),
    sourceId: match[2]!.trim(),
    sourceVersion: match[3]!.trim(),
    pageNumber: match[4] ? Number.parseInt(match[4], 10) : undefined,
  };
}

/**
 * Maps Aditi's approved BrandKnowledgeRecord into the visual module's
 * internal BrandVisualContext without inventing rules or hard-coding brand rules.
 */
export function adaptBrandKnowledgeToVisualContext(
  record: BrandKnowledgeRecord,
  options: { referenceLogoBuffers?: Map<string, Buffer> } = {},
): BrandVisualContext {
  const warnings: string[] = [];
  if (!record.profile.approved) {
    return {
      brandId: record.profile.brandId,
      brandName: record.profile.brandName,
      guidelineVersion: record.profile.source.versionId,
      approved: false,
      approvedPalette: [],
      approvedLogos: [],
      logoRequired: false,
      typographyRequirements: [],
      layoutRequirements: [],
      requiredVisualElements: [],
      prohibitedVisualStyles: [],
      rules: [],
      validSourceIds: [],
      validVersions: [],
      hasVisualKnowledge: false,
      warnings: ["Brand profile is not approved; visual checks skipped."],
    };
  }

  const paletteMap = new Map<string, ApprovedColorSpec>();
  const approvedVisualRecords = record.visualAssets.filter((v) => v.approved);

  // 1. Visual asset COLOUR records (have exact source metadata & pageNumber)
  for (const asset of approvedVisualRecords) {
    if (asset.kind !== "COLOUR") continue;
    const specs = parseColorSpecFromString(asset.value, {
      sourceId: asset.source.sourceDocumentId,
      sourceVersion: asset.source.versionId,
      sourceTitle: asset.source.sourceTitle,
      pageNumber: asset.source.pageNumber,
    });
    for (const spec of specs) {
      paletteMap.set(spec.hex, spec);
    }
  }

  // 2. Fallback to profile.approvedColours if visualAssets lacked them
  for (const colorStr of record.profile.approvedColours) {
    const specs = parseColorSpecFromString(colorStr, {
      sourceId: record.profile.source.sourceDocumentId,
      sourceVersion: record.profile.source.versionId,
      sourceTitle: record.profile.source.sourceTitle,
      pageNumber: record.profile.source.pageNumber,
    });
    for (const spec of specs) {
      if (!paletteMap.has(spec.hex)) {
        paletteMap.set(spec.hex, spec);
      }
    }
  }

  const approvedPalette = [...paletteMap.values()];
  if (approvedPalette.length === 0) {
    warnings.push("NO_APPROVED_PALETTE");
  }

  // 3. Logo rules & variants
  const approvedLogos: ApprovedLogoRule[] = [];
  const logoPaletteHexes = approvedPalette.slice(0, 2).map((c) => c.hex);
  const logoAssets = approvedVisualRecords.filter((v) => v.kind === "LOGO");
  const allLogoGuidanceText = [
    ...record.profile.designGuidelines,
    ...logoAssets.map((l) => l.value),
  ].join(" ");

  const minWidthPxMatch = allLogoGuidanceText.match(/(\d+)\s*px\s*wide/i);
  const minWidthMmMatch = allLogoGuidanceText.match(/(\d+)\s*mm\s*wide/i);
  const minWidthPx = minWidthPxMatch ? Number.parseInt(minWidthPxMatch[1]!, 10) : undefined;
  const minWidthMm = minWidthMmMatch ? Number.parseInt(minWidthMmMatch[1]!, 10) : undefined;

  const logoRequired = /\b(mandatory|required|must\s+(?:appear|include|display))\b/i.test(
    allLogoGuidanceText,
  );

  for (const [idx, logoDesc] of record.profile.approvedLogoReferences.entries()) {
    const src = logoAssets[0]?.source ?? record.profile.source;
    approvedLogos.push({
      id: `logo-ref-${idx + 1}`,
      variantName: logoDesc.split(" with ")[0]?.trim() || logoDesc,
      description: logoDesc,
      expectedColorsHex: logoPaletteHexes,
      minWidthPx,
      minWidthMm,
      clearSpaceRule: record.profile.designGuidelines.find((g) => /clear\s*space/i.test(g)),
      required: logoRequired,
      referencePngBuffer: options.referenceLogoBuffers?.get(`logo-ref-${idx + 1}`),
      sourceId: src.sourceDocumentId,
      sourceVersion: src.versionId,
      sourceTitle: src.sourceTitle,
      pageNumber: src.pageNumber,
      excerpt: logoAssets[0]?.value ?? logoDesc,
    });
  }

  for (const [idx, asset] of logoAssets.entries()) {
    if (approvedLogos.length === 0) {
      approvedLogos.push({
        id: `logo-asset-${idx + 1}`,
        variantName: "Approved Brand Logo",
        description: asset.value,
        expectedColorsHex: logoPaletteHexes,
        minWidthPx,
        minWidthMm,
        clearSpaceRule: record.profile.designGuidelines.find((g) => /clear\s*space/i.test(g)),
        required: logoRequired,
        referencePngBuffer: options.referenceLogoBuffers?.get(`logo-asset-${idx + 1}`),
        sourceId: asset.source.sourceDocumentId,
        sourceVersion: asset.source.versionId,
        sourceTitle: asset.source.sourceTitle,
        pageNumber: asset.source.pageNumber,
        excerpt: asset.value,
      });
    }
  }

  if (approvedLogos.length === 0) {
    warnings.push("NO_APPROVED_LOGOS");
  }

  // 4. Visual rules collection with real provenance
  const rules: ApprovedVisualRule[] = [];
  for (const asset of approvedVisualRecords) {
    const category: ApprovedVisualRule["category"] =
      asset.kind === "COLOUR"
        ? "colour"
        : asset.kind === "LOGO"
          ? "logo"
          : asset.kind === "TYPOGRAPHY"
            ? "typography"
            : "visual_consistency";
    rules.push({
      ruleId: extractRuleId(asset.value) ?? `VISUAL-${asset.kind}`,
      category,
      description: asset.value,
      sourceId: asset.source.sourceDocumentId,
      sourceVersion: asset.source.versionId,
      sourceTitle: asset.source.sourceTitle,
      pageNumber: asset.source.pageNumber,
      excerpt: asset.value,
    });
  }

  for (const guideline of record.guidelines.filter((g) => g.approved && g.kind === "DESIGN")) {
    rules.push({
      ruleId: extractRuleId(guideline.value) ?? "DESIGN-01",
      category: "layout",
      description: guideline.value,
      sourceId: guideline.source.sourceDocumentId,
      sourceVersion: guideline.source.versionId,
      sourceTitle: guideline.source.sourceTitle,
      pageNumber: guideline.source.pageNumber,
      excerpt: guideline.value,
    });
  }

  for (const designText of record.profile.designGuidelines) {
    const sourceForDesign =
      approvedVisualRecords[0]?.source ?? record.profile.source;
    rules.push({
      ruleId: extractRuleId(designText) ?? (/colour|palette/i.test(designText) ? "IMG-03" : /logo|clear space/i.test(designText) ? "LOG-01" : "IMG-01"),
      category: /colour|palette/i.test(designText)
        ? "colour"
        : /logo|clear space|droplet/i.test(designText)
          ? "logo"
          : "layout",
      description: designText,
      sourceId: sourceForDesign.sourceDocumentId,
      sourceVersion: sourceForDesign.versionId,
      sourceTitle: sourceForDesign.sourceTitle,
      pageNumber: sourceForDesign.pageNumber,
      excerpt: designText,
    });
  }

  const layoutRequirements = record.profile.designGuidelines.filter((d) =>
    /clear\s*space|min|size|margin|layout|contrast|composition|background/i.test(d),
  );
  const prohibitedVisualStyles = record.profile.usagePolicies.filter((p) =>
    /recolour|distort|crop|watermark|shadow|gradient|visual/i.test(p),
  );

  const allSources = [
    record.profile.source,
    ...record.guidelines.map((g) => g.source),
    ...record.visualAssets.map((v) => v.source),
  ];

  const validSourceIds = [...new Set(allSources.map((s) => s.sourceDocumentId))];
  const validVersions = [...new Set(allSources.map((s) => s.versionId))];

  const hasVisualKnowledge =
    approvedPalette.length > 0 ||
    approvedLogos.length > 0 ||
    record.profile.typographyReferences.length > 0 ||
    rules.length > 0;

  if (!hasVisualKnowledge) {
    warnings.push("NO_APPROVED_VISUAL_GUIDELINES");
  }

  return {
    brandId: record.profile.brandId,
    brandName: record.profile.brandName,
    guidelineVersion: record.profile.source.versionId,
    approved: true,
    approvedPalette,
    approvedLogos,
    logoRequired,
    typographyRequirements: [...record.profile.typographyReferences],
    layoutRequirements,
    requiredVisualElements: [...record.profile.assetMetadata],
    prohibitedVisualStyles,
    rules,
    validSourceIds,
    validVersions,
    hasVisualKnowledge,
    warnings,
  };
}

/**
 * Fallback adapter when only the flat Phase 1 BrandContext contract is available.
 */
export function adaptBrandContextToVisualContext(
  context: BrandContext,
  brandId = "unknown-brand",
): BrandVisualContext {
  const defaultSourceId = context.sourceIds[0] ?? "unknown-source";
  const defaultVersion = context.versionId.split(",")[0]?.trim() || "1.0";
  const defaultTitle = context.sourceVersionInformation.split("(")[0]?.trim() || "Brand Guidelines";

  const paletteMap = new Map<string, ApprovedColorSpec>();
  for (const colorStr of context.approvedColours) {
    const src = parseSourceFromBracket(colorStr, defaultSourceId, defaultVersion, defaultTitle);
    const specs = parseColorSpecFromString(colorStr, src);
    for (const spec of specs) {
      paletteMap.set(spec.hex, spec);
    }
  }
  const approvedPalette = [...paletteMap.values()];

  const rules: ApprovedVisualRule[] = [];
  for (const item of [...context.approvedGuidelines, ...context.approvedVisualAssetReferences]) {
    const src = parseSourceFromBracket(item, defaultSourceId, defaultVersion, defaultTitle);
    const clean = item.split(/\s+\[Source:/i, 1)[0]?.trim() ?? item;
    if (/colour|palette|logo|typography|font|clear space|layout|contrast|droplet|bottle|visual|IMG-|LOG-/i.test(clean)) {
      rules.push({
        ruleId: extractRuleId(clean) ?? "VISUAL-RULE",
        category: /colour|palette/i.test(clean)
          ? "colour"
          : /logo|droplet|mark/i.test(clean)
            ? "logo"
            : /font|typography|sans|serif/i.test(clean)
              ? "typography"
              : "layout",
        description: clean,
        sourceId: src.sourceId,
        sourceVersion: src.sourceVersion,
        sourceTitle: src.sourceTitle,
        pageNumber: src.pageNumber,
        excerpt: clean,
      });
    }
  }

  const approvedLogos: ApprovedLogoRule[] = context.approvedVisualAssetReferences
    .filter((ref) => /logo|mark|wordmark/i.test(ref))
    .map((ref, idx) => {
      const src = parseSourceFromBracket(ref, defaultSourceId, defaultVersion, defaultTitle);
      const clean = ref.split(/\s+\[Source:/i, 1)[0]?.trim() ?? ref;
      return {
        id: `logo-ctx-${idx + 1}`,
        variantName: clean.split(" with ")[0]?.trim() || clean,
        description: clean,
        expectedColorsHex: approvedPalette.slice(0, 2).map((c) => c.hex),
        required: false,
        sourceId: src.sourceId,
        sourceVersion: src.sourceVersion,
        sourceTitle: src.sourceTitle,
        pageNumber: src.pageNumber,
        excerpt: clean,
      };
    });

  const typographyRequirements = context.approvedVisualAssetReferences.filter((ref) =>
    /font|manrope|inter|sans|serif|typography/i.test(ref),
  );

  const warnings: string[] = [];
  if (approvedPalette.length === 0) warnings.push("NO_APPROVED_PALETTE");
  if (approvedLogos.length === 0) warnings.push("NO_APPROVED_LOGOS");

  const brandName = context.brandProfile.split("(")[0]?.trim() || brandId;

  return {
    brandId,
    brandName,
    guidelineVersion: defaultVersion,
    approved: true,
    approvedPalette,
    approvedLogos,
    logoRequired: false,
    typographyRequirements,
    layoutRequirements: rules.filter((r) => r.category === "layout").map((r) => r.description),
    requiredVisualElements: [],
    prohibitedVisualStyles: [],
    rules,
    validSourceIds: [...context.sourceIds],
    validVersions: context.versionId.split(",").map((v) => v.trim()).filter(Boolean),
    hasVisualKnowledge:
      approvedPalette.length > 0 || approvedLogos.length > 0 || rules.length > 0,
    warnings,
  };
}
