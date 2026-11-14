import assert from "node:assert/strict";
import test from "node:test";
import {
  GuidelineDocumentRecordSchema,
  type GuidelineRecordBuildInput,
} from "../lib/guidelines/records";
import {
  buildGuidelineDocumentRecord,
  GuidelineRecordBuildError,
} from "../lib/guidelines/record-builder";
import type { PdfExtractionResult } from "../lib/guidelines/types";

function makeExtraction(): PdfExtractionResult {
  return {
    fileName: "brand-guide.pdf",
    totalPageCount: 2,
    status: "TEXT_EXTRACTED",
    pages: [
      {
        pageNumber: 1,
        text: "😀 Voice rules: Use clear, direct wording.",
        status: "TEXT_EXTRACTED",
      },
      {
        pageNumber: 2,
        text: "Claims: Do not promise unsupported outcomes.",
        status: "TEXT_EXTRACTED",
      },
    ],
  };
}

function spanFor(text: string, value: string) {
  const startOffset = text.indexOf(value);
  assert.notEqual(startOffset, -1);
  return {
    startOffset,
    endOffset: startOffset + value.length,
  };
}

function makeInput(
  overrides: Partial<GuidelineRecordBuildInput> = {},
): GuidelineRecordBuildInput {
  const extraction = makeExtraction();
  const firstText = "Use clear, direct wording.";
  const secondText = "Do not promise unsupported outcomes.";
  const firstSpan = spanFor(extraction.pages[0]!.text, firstText);
  const secondSpan = spanFor(extraction.pages[1]!.text, secondText);

  return {
    documentId: "doc-brand-42",
    title: "Brand Governance Guide",
    versionId: "v3",
    extraction,
    sections: [
      {
        sectionId: "voice",
        name: "Voice rules",
        startPage: 1,
        endPage: 1,
      },
      {
        sectionId: "claims",
        name: "Claims",
        startPage: 2,
        endPage: 2,
      },
    ],
    rules: [
      {
        ruleId: "rule-voice-1",
        sectionId: "voice",
        pageNumber: 1,
        ...firstSpan,
      },
      {
        ruleId: "rule-claims-1",
        sectionId: "claims",
        pageNumber: 2,
        ...secondSpan,
      },
    ],
    ...overrides,
  };
}

test("builds a valid multi-page document with separate sections and rules", () => {
  const input = makeInput();
  const record = buildGuidelineDocumentRecord(input);

  assert.equal(record.documentId, "doc-brand-42");
  assert.equal(record.versionId, "v3");
  assert.equal(record.extraction.totalPageCount, 2);
  assert.deepEqual(
    record.rules.map((rule) => rule.source.pageNumber),
    [1, 2],
  );
  assert.deepEqual(
    record.rules.map((rule) => rule.source.section),
    ["Voice rules", "Claims"],
  );
  assert.ok(record.rules.every((rule) => rule.reviewStatus === "PENDING_REVIEW"));
});

test("preserves extracted page text and source text exactly", () => {
  const input = makeInput();
  const originalPageText = input.extraction.pages[0]!.text;
  const selectedText = "Use clear, direct wording.";
  const record = buildGuidelineDocumentRecord(input);
  const rule = record.rules[0]!;
  const startOffset = originalPageText.indexOf(selectedText);

  assert.equal(input.extraction.pages[0]!.text, originalPageText);
  assert.equal(record.extraction.pages[0]!.text, originalPageText);
  assert.equal(rule.originalText, selectedText);
  assert.equal(rule.source.excerpt, selectedText);
  assert.equal(rule.source.startOffset, startOffset);
  assert.equal(
    record.extraction.pages[0]!.text.slice(
      rule.source.startOffset,
      rule.source.endOffset,
    ),
    rule.source.excerpt,
  );
});

test("uses UTF-16 code-unit offsets for source excerpts", () => {
  const input = makeInput();
  const record = buildGuidelineDocumentRecord(input);
  const rule = record.rules[0]!;

  assert.equal(rule.source.startOffset, 16);
  assert.equal(rule.source.excerpt, "Use clear, direct wording.");
});

test("rejects source page numbers that do not exist", () => {
  const input = makeInput({
    rules: [
      {
        ruleId: "rule-missing-page",
        sectionId: "claims",
        pageNumber: 3,
        startOffset: 0,
        endOffset: 1,
      },
    ],
  });

  assert.throws(
    () => buildGuidelineDocumentRecord(input),
    (error: unknown) =>
      error instanceof GuidelineRecordBuildError &&
      error.code === "SOURCE_PAGE_NOT_FOUND",
  );
});

test("rejects invalid offsets and mismatched source excerpts", () => {
  const input = makeInput({
    rules: [
      {
        ruleId: "rule-invalid-offset",
        sectionId: "voice",
        pageNumber: 1,
        startOffset: 0,
        endOffset: 10_000,
      },
    ],
  });

  assert.throws(
    () => buildGuidelineDocumentRecord(input),
    (error: unknown) =>
      error instanceof GuidelineRecordBuildError &&
      error.code === "SOURCE_SPAN_OUT_OF_RANGE",
  );

  const record = buildGuidelineDocumentRecord(makeInput());
  const firstRule = record.rules[0]!;
  const mismatchedRecord = {
    ...record,
    rules: [
      {
        ...firstRule,
        source: { ...firstRule.source, excerpt: "not the cited text" },
      },
      ...record.rules.slice(1),
    ],
  };

  assert.equal(GuidelineDocumentRecordSchema.safeParse(mismatchedRecord).success, false);
});

test("keeps original text and source excerpt unchanged when reviewed text is supplied", () => {
  const input = makeInput({
    rules: [
      {
        ...makeInput().rules[0]!,
        reviewedText: "Use concise, direct language.",
      },
    ],
  });
  const record = buildGuidelineDocumentRecord(input);
  const rule = record.rules[0]!;

  assert.equal(rule.originalText, "Use clear, direct wording.");
  assert.equal(rule.reviewedText, "Use concise, direct language.");
  assert.equal(rule.source.excerpt, "Use clear, direct wording.");
});

test("rejects missing document metadata", () => {
  const input = makeInput();
  for (const field of ["documentId", "title", "versionId"] as const) {
    const incompleteInput = { ...input };
    Reflect.deleteProperty(incompleteInput, field);
    assert.throws(() => buildGuidelineDocumentRecord(incompleteInput));
  }
});

test("rejects rules that reference an unknown or out-of-range section", () => {
  const unknownSection = makeInput({
    rules: [
      {
        ...makeInput().rules[0]!,
        sectionId: "missing-section",
      },
    ],
  });
  assert.throws(
    () => buildGuidelineDocumentRecord(unknownSection),
    (error: unknown) =>
      error instanceof GuidelineRecordBuildError &&
      error.code === "SECTION_NOT_FOUND",
  );

  const outOfRangeSection = makeInput({
    sections: [
      {
        sectionId: "voice",
        name: "Voice rules",
        startPage: 2,
        endPage: 2,
      },
    ],
    rules: [
      {
        ...makeInput().rules[0]!,
      },
    ],
  });
  assert.throws(() => buildGuidelineDocumentRecord(outOfRangeSection));
});
