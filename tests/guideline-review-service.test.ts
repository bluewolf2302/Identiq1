import assert from "node:assert/strict";
import test from "node:test";
import { buildGuidelineDocumentRecord } from "../lib/guidelines/record-builder";
import {
  createInMemoryGuidelineReviewService,
  GuidelineReviewServiceError,
} from "../lib/guidelines/review-service";
import type { PdfExtractionResult } from "../lib/guidelines/types";

const extraction: PdfExtractionResult = {
  fileName: "review-guide.pdf",
  totalPageCount: 1,
  status: "TEXT_EXTRACTED",
  pages: [
    {
      pageNumber: 1,
      text: "Use clear, direct wording.",
      status: "TEXT_EXTRACTED",
    },
  ],
};

function makeDocument() {
  return buildGuidelineDocumentRecord({
    documentId: "temporary-doc-1",
    title: "Temporary Review Guide",
    versionId: "version-1",
    extraction,
    sections: [
      {
        sectionId: "section-1",
        name: "Voice",
        startPage: 1,
        endPage: 1,
      },
    ],
    rules: [
      {
        ruleId: "rule-1",
        sectionId: "section-1",
        pageNumber: 1,
        startOffset: 0,
        endOffset: extraction.pages[0]!.text.length,
      },
    ],
  });
}

test("keeps guideline drafts in isolated in-memory service instances", async () => {
  const service = createInMemoryGuidelineReviewService(async () => extraction);
  const isolatedService = createInMemoryGuidelineReviewService(async () => extraction);

  await service.createDraft(makeDocument());

  assert.equal((await service.listDocuments()).length, 1);
  assert.deepEqual(await isolatedService.listDocuments(), []);
});

test("rule edits and decisions preserve the original source reference", async () => {
  const service = createInMemoryGuidelineReviewService(async () => extraction);
  await service.createDraft(makeDocument());

  const updated = await service.updateRule(
    "temporary-doc-1",
    "version-1",
    "rule-1",
    {
      reviewedText: "Use concise, direct language.",
      reviewStatus: "ACCEPTED",
    },
  );
  const rule = updated.rules[0]!;

  assert.equal(rule.originalText, "Use clear, direct wording.");
  assert.equal(rule.reviewedText, "Use concise, direct language.");
  assert.equal(rule.reviewStatus, "ACCEPTED");
  assert.equal(rule.source.excerpt, "Use clear, direct wording.");
  assert.equal(
    updated.extraction.pages[0]!.text.slice(
      rule.source.startOffset,
      rule.source.endOffset,
    ),
    rule.source.excerpt,
  );
  assert.equal("approvalStatus" in updated, false);
});

test("rejects duplicate document versions and unknown rules", async () => {
  const service = createInMemoryGuidelineReviewService(async () => extraction);
  await service.createDraft(makeDocument());

  await assert.rejects(
    service.createDraft(makeDocument()),
    (error: unknown) =>
      error instanceof GuidelineReviewServiceError &&
      error.code === "DUPLICATE_DRAFT",
  );
  await assert.rejects(
    service.updateRule("temporary-doc-1", "version-1", "missing-rule", {
      reviewStatus: "REJECTED",
    }),
    (error: unknown) =>
      error instanceof GuidelineReviewServiceError &&
      error.code === "RULE_NOT_FOUND",
  );
});
