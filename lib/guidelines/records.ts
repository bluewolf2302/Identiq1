import { z } from "zod";
import type { PdfExtractionResult } from "./types";
import { PdfExtractionResultSchema } from "./types";
import {
  EvidenceReferenceSchema,
  type EvidenceReference,
} from "../contracts/findings";

const nonEmptyPreservedString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

export const GuidelineReviewStatusSchema = z.enum([
  "PENDING_REVIEW",
  "ACCEPTED",
  "REJECTED",
]);

export const GuidelineSectionRecordSchema = z
  .object({
    sectionId: nonEmptyPreservedString,
    name: nonEmptyPreservedString,
    startPage: z.number().int().positive(),
    endPage: z.number().int().positive(),
  })
  .strict();

export const GuidelineSourceReferenceSchema = EvidenceReferenceSchema.extend({
  sourceId: nonEmptyPreservedString,
  sourceTitle: nonEmptyPreservedString,
  versionId: nonEmptyPreservedString,
  pageNumber: z.number().int().positive(),
  section: nonEmptyPreservedString,
  excerpt: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  sourceType: z.literal("brand_guideline_pdf"),
})
  .strict()
  .refine((source) => source.endOffset > source.startOffset, {
    message: "endOffset must be greater than startOffset",
    path: ["endOffset"],
  });

export const GuidelineRuleRecordSchema = z
  .object({
    ruleId: nonEmptyPreservedString,
    sectionId: nonEmptyPreservedString,
    originalText: z.string().min(1),
    reviewedText: z.string().optional(),
    reviewStatus: GuidelineReviewStatusSchema,
    source: GuidelineSourceReferenceSchema,
  })
  .strict();

export const GuidelineDocumentRecordSchema = z
  .object({
    documentId: nonEmptyPreservedString,
    title: nonEmptyPreservedString,
    versionId: nonEmptyPreservedString,
    extraction: PdfExtractionResultSchema,
    sections: z.array(GuidelineSectionRecordSchema),
    rules: z.array(GuidelineRuleRecordSchema),
  })
  .strict()
  .superRefine((document, context) => {
    const sectionIds = new Set<string>();
    for (const [index, section] of document.sections.entries()) {
      if (sectionIds.has(section.sectionId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate sectionId "${section.sectionId}".`,
          path: ["sections", index, "sectionId"],
        });
      }
      sectionIds.add(section.sectionId);

      if (section.startPage > section.endPage) {
        context.addIssue({
          code: "custom",
          message: "Section startPage must not be after endPage.",
          path: ["sections", index, "startPage"],
        });
      }
      if (
        section.startPage > document.extraction.totalPageCount ||
        section.endPage > document.extraction.totalPageCount
      ) {
        context.addIssue({
          code: "custom",
          message: "Section pages must exist in the source document.",
          path: ["sections", index],
        });
      }
    }

    const ruleIds = new Set<string>();
    for (const [index, rule] of document.rules.entries()) {
      if (ruleIds.has(rule.ruleId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate ruleId "${rule.ruleId}".`,
          path: ["rules", index, "ruleId"],
        });
      }
      ruleIds.add(rule.ruleId);

      const section = document.sections.find(
        (candidate) => candidate.sectionId === rule.sectionId,
      );
      if (!section) {
        context.addIssue({
          code: "custom",
          message: "Rule must reference a section in this document.",
          path: ["rules", index, "sectionId"],
        });
        continue;
      }

      const source = rule.source;
      if (
        source.sourceId !== document.documentId ||
        source.sourceTitle !== document.title ||
        source.versionId !== document.versionId
      ) {
        context.addIssue({
          code: "custom",
          message: "Rule source metadata must match its document record.",
          path: ["rules", index, "source"],
        });
      }

      if (
        source.section !== section.name ||
        source.pageNumber < section.startPage ||
        source.pageNumber > section.endPage
      ) {
        context.addIssue({
          code: "custom",
          message: "Rule source location must belong to its referenced section.",
          path: ["rules", index, "source"],
        });
      }

      const page = document.extraction.pages.find(
        (candidate) => candidate.pageNumber === source.pageNumber,
      );
      if (!page) {
        context.addIssue({
          code: "custom",
          message: "Rule source page must exist in the extraction.",
          path: ["rules", index, "source", "pageNumber"],
        });
        continue;
      }

      if (source.endOffset > page.text.length) {
        context.addIssue({
          code: "custom",
          message: "Rule source offsets must be within the page text.",
          path: ["rules", index, "source", "endOffset"],
        });
        continue;
      }

      const selectedText = page.text.slice(
        source.startOffset,
        source.endOffset,
      );
      if (selectedText !== source.excerpt) {
        context.addIssue({
          code: "custom",
          message: "Source excerpt must exactly match the selected page text.",
          path: ["rules", index, "source", "excerpt"],
        });
      }
      if (selectedText !== rule.originalText) {
        context.addIssue({
          code: "custom",
          message: "originalText must exactly match the selected page text.",
          path: ["rules", index, "originalText"],
        });
      }
    }
  });

export const GuidelineSectionSpanInputSchema = GuidelineSectionRecordSchema;

export const GuidelineRuleSpanInputSchema = z
  .object({
    ruleId: nonEmptyPreservedString,
    sectionId: nonEmptyPreservedString,
    pageNumber: z.number().int().positive(),
    /** Offsets use JavaScript string indexing: UTF-16 code units. */
    startOffset: z.number().int().nonnegative(),
    /** Offsets use JavaScript string indexing: UTF-16 code units. */
    endOffset: z.number().int().positive(),
    reviewedText: z.string().optional(),
  })
  .strict()
  .refine((rule) => rule.endOffset > rule.startOffset, {
    message: "endOffset must be greater than startOffset",
    path: ["endOffset"],
  });

export const GuidelineRecordBuildInputSchema = z
  .object({
    documentId: nonEmptyPreservedString,
    title: nonEmptyPreservedString,
    versionId: nonEmptyPreservedString,
    extraction: PdfExtractionResultSchema,
    sections: z.array(GuidelineSectionSpanInputSchema),
    rules: z.array(GuidelineRuleSpanInputSchema),
  })
  .strict();

export type GuidelineReviewStatus = z.infer<
  typeof GuidelineReviewStatusSchema
>;
export type GuidelineSectionRecord = z.infer<
  typeof GuidelineSectionRecordSchema
>;
type GuidelineDocumentRecordSchemaOutput = z.infer<
  typeof GuidelineDocumentRecordSchema
>;
type GuidelineRecordBuildInputSchemaOutput = z.infer<
  typeof GuidelineRecordBuildInputSchema
>;

/** Source offsets are UTF-16 code-unit offsets, matching JavaScript String.slice. */
export type GuidelineSourceReference =
  Required<
    Pick<
      EvidenceReference,
      | "sourceId"
      | "sourceTitle"
      | "versionId"
      | "pageNumber"
      | "section"
      | "excerpt"
    >
  > &
    {
      sourceType: "brand_guideline_pdf";
      startOffset: number;
      endOffset: number;
    };
export type GuidelineRuleRecord = z.infer<
  typeof GuidelineRuleRecordSchema
>;
export type GuidelineDocumentRecord = Omit<
  GuidelineDocumentRecordSchemaOutput,
  "extraction"
> & { extraction: PdfExtractionResult };
export type GuidelineSectionSpanInput = z.infer<
  typeof GuidelineSectionSpanInputSchema
>;
export type GuidelineRuleSpanInput = z.infer<
  typeof GuidelineRuleSpanInputSchema
>;
export type GuidelineRecordBuildInput = Omit<
  GuidelineRecordBuildInputSchemaOutput,
  "extraction"
> & { extraction: PdfExtractionResult };
