import type {
  BrandVisualContext,
  OcrBlock,
  ProcessedPage,
  VisualFinding,
  VisualObservation,
} from "../types";

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding = 0,
): boolean {
  return (
    a.x - padding < b.x + b.width &&
    a.x + a.width + padding > b.x &&
    a.y - padding < b.y + b.height &&
    a.y + a.height + padding > b.y
  );
}

export function runLayoutCheck(
  page: ProcessedPage,
  pageOcrBlocks: OcrBlock[],
  detectedLogoBoxes: Array<{ x: number; y: number; width: number; height: number }>,
  brandContext: BrandVisualContext,
): {
  findings: VisualFinding[];
  observations: VisualObservation[];
} {
  if (page.status !== "ok") {
    return { findings: [], observations: [] };
  }

  const findings: VisualFinding[] = [];
  const observations: VisualObservation[] = [];

  const layoutRule =
    brandContext.rules.find((r) => r.category === "layout") ??
    brandContext.rules[0];
  const clearSpaceRule =
    brandContext.rules.find((r) => r.ruleId === "LOG-03") ?? layoutRule;

  // 1. Check edge-clipped text blocks
  const clippedBlock = pageOcrBlocks.find(
    (b) =>
      !b.uncertain &&
      (b.boundingBox.x <= 0.002 ||
        b.boundingBox.y <= 0.002 ||
        b.boundingBox.x + b.boundingBox.width >= 0.998 ||
        b.boundingBox.y + b.boundingBox.height >= 0.998),
  );

  if (clippedBlock) {
    findings.push({
      id: `vis-layout-margin-p${page.pageNumber}`,
      ruleId: layoutRule?.ruleId ?? "IMG-05",
      category: "layout",
      title: "Text element sits flush against canvas edge without margin",
      explanation: `Text block "${clippedBlock.text.slice(
        0,
        45,
      )}" extends to the edge of page ${page.pageNumber}, risking clipping in print or social crops.`,
      expectedValue: "Adequate whitespace and safe margins around copy",
      observedValue: `Text box touches edge (${Math.round(clippedBlock.boundingBox.x * 100)}%, ${Math.round(
        clippedBlock.boundingBox.y * 100,
      )}%)`,
      sourceReference: {
        sourceId: layoutRule?.sourceId ?? null,
        sourceVersion: layoutRule?.sourceVersion ?? null,
        sourceTitle: layoutRule?.sourceTitle ?? null,
        pageNumber: layoutRule?.pageNumber ?? null,
        excerpt: layoutRule?.excerpt ?? null,
      },
      creativeEvidence: {
        assetId: page.originalAssetId,
        pageNumber: page.pageNumber,
        boundingBox: clippedBlock.boundingBox,
        description: `Edge-adjacent text block on page ${page.pageNumber}`,
      },
      confidence: 0.74,
      reviewStatus: "needs_human_review",
      severity: "LOW",
      detector: "deterministic",
      classification: "design_recommendation",
      suggestedCorrection: "Add safe outer margin padding so text is not clipped.",
    });
  }

  // 2. Logo clear-space intrusion check (only if logo region detected and clear space rule exists)
  if (detectedLogoBoxes.length > 0 && clearSpaceRule) {
    const logoBox = detectedLogoBoxes[0]!;
    const clearPad = Math.max(0.02, logoBox.height * 0.45);
    const intrudingText = pageOcrBlocks.find((b) => {
      // Ignore the brand's own wordmark/tagline inside the logo box
      if (
        b.text.toLowerCase().includes(brandContext.brandName.toLowerCase()) ||
        boxesOverlap(b.boundingBox, logoBox, 0)
      ) {
        return false;
      }
      return boxesOverlap(b.boundingBox, logoBox, clearPad);
    });

    if (intrudingText) {
      findings.push({
        id: `vis-layout-clearspace-p${page.pageNumber}`,
        ruleId: "LOG-03",
        category: "layout",
        title: "Possible logo clear-space crowding",
        explanation: `Text element "${intrudingText.text.slice(
          0,
          40,
        )}" appears close to the detected logo boundary on page ${page.pageNumber}.`,
        expectedValue: "Empty clear space around the logo equal to at least the symbol height",
        observedValue: `Adjacent element "${intrudingText.text.slice(0, 35)}" inside clear-space buffer`,
        sourceReference: {
          sourceId: clearSpaceRule.sourceId,
          sourceVersion: clearSpaceRule.sourceVersion,
          sourceTitle: clearSpaceRule.sourceTitle,
          pageNumber: clearSpaceRule.pageNumber ?? null,
          excerpt: clearSpaceRule.excerpt,
        },
        creativeEvidence: {
          assetId: page.originalAssetId,
          pageNumber: page.pageNumber,
          boundingBox: logoBox,
          description: `Logo clear-space region near "${intrudingText.text.slice(0, 30)}" on page ${page.pageNumber}`,
        },
        confidence: 0.62,
        reviewStatus: "needs_human_review",
        severity: "MEDIUM",
        detector: "deterministic",
        classification: "possible_mismatch",
        suggestedCorrection: "Increase empty margin around the brand logo.",
      });
    }
  }

  observations.push({
    pageNumber: page.pageNumber,
    detector: "deterministic-layout",
    summary: `Checked ${pageOcrBlocks.length} text region(s) and ${detectedLogoBoxes.length} logo region(s) for edge margins and clear-space crowding.`,
  });

  return { findings, observations };
}
