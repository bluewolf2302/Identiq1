import {
  GuidelineDocumentRecordSchema,
  GuidelineRecordBuildInputSchema,
  type GuidelineDocumentRecord,
} from "./records";

export type GuidelineRecordBuildErrorCode =
  | "SECTION_NOT_FOUND"
  | "SOURCE_PAGE_NOT_FOUND"
  | "SOURCE_SPAN_OUT_OF_RANGE";

export class GuidelineRecordBuildError extends Error {
  readonly code: GuidelineRecordBuildErrorCode;

  constructor(code: GuidelineRecordBuildErrorCode, message: string) {
    super(message);
    this.name = "GuidelineRecordBuildError";
    this.code = code;
  }
}

export function buildGuidelineDocumentRecord(
  input: unknown,
): GuidelineDocumentRecord {
  const parsedInput = GuidelineRecordBuildInputSchema.parse(input);
  const sectionsById = new Map(
    parsedInput.sections.map((section) => [section.sectionId, section]),
  );

  const rules = parsedInput.rules.map((rule) => {
    const section = sectionsById.get(rule.sectionId);
    if (!section) {
      throw new GuidelineRecordBuildError(
        "SECTION_NOT_FOUND",
        `Rule "${rule.ruleId}" references a section not present in the document.`,
      );
    }

    const page = parsedInput.extraction.pages.find(
      (candidate) => candidate.pageNumber === rule.pageNumber,
    );
    if (!page) {
      throw new GuidelineRecordBuildError(
        "SOURCE_PAGE_NOT_FOUND",
        `Rule "${rule.ruleId}" references a page not present in the extraction.`,
      );
    }

    if (
      rule.startOffset >= page.text.length ||
      rule.endOffset > page.text.length
    ) {
      throw new GuidelineRecordBuildError(
        "SOURCE_SPAN_OUT_OF_RANGE",
        `Rule "${rule.ruleId}" has offsets outside page ${rule.pageNumber}.`,
      );
    }

    const excerpt = page.text.slice(rule.startOffset, rule.endOffset);
    return {
      ruleId: rule.ruleId,
      sectionId: rule.sectionId,
      originalText: excerpt,
      ...(rule.reviewedText === undefined
        ? {}
        : { reviewedText: rule.reviewedText }),
      reviewStatus: "PENDING_REVIEW" as const,
      source: {
        sourceId: parsedInput.documentId,
        sourceType: "brand_guideline_pdf" as const,
        sourceTitle: parsedInput.title,
        versionId: parsedInput.versionId,
        pageNumber: rule.pageNumber,
        section: section.name,
        excerpt,
        startOffset: rule.startOffset,
        endOffset: rule.endOffset,
      },
    };
  });

  return GuidelineDocumentRecordSchema.parse({
    documentId: parsedInput.documentId,
    title: parsedInput.title,
    versionId: parsedInput.versionId,
    extraction: parsedInput.extraction,
    sections: parsedInput.sections,
    rules,
  });
}
