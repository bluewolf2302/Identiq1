"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Upload,
  XCircle,
} from "lucide-react";
import {
  GuidelineDocumentRecordSchema,
  type GuidelineDocumentRecord,
  type GuidelineReviewStatus,
  type GuidelineRuleRecord,
} from "@/lib/guidelines/records";
import {
  guidelineReviewService,
} from "@/lib/guidelines/review-service";

type SelectedSourceText = {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
};

const REVIEW_STATUS_LABEL: Record<GuidelineReviewStatus, string> = {
  PENDING_REVIEW: "Pending review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

function getDocumentKey(document: GuidelineDocumentRecord): string {
  return JSON.stringify([document.documentId, document.versionId]);
}

function getRuleDraftKey(
  document: GuidelineDocumentRecord,
  ruleId: string,
): string {
  return `${getDocumentKey(document)}:${ruleId}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The guideline operation failed.";
}

export function GuidelinePdfReviewPanel() {
  const [documents, setDocuments] = useState<GuidelineDocumentRecord[]>([]);
  const [activeDocumentKey, setActiveDocumentKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [title, setTitle] = useState("");
  const [versionId, setVersionId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [selection, setSelection] = useState<SelectedSourceText | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewedTextDrafts, setReviewedTextDrafts] = useState<
    Record<string, string>
  >({});
  const [busyRuleId, setBusyRuleId] = useState("");
  const pageTextRefs = useRef(new Map<number, HTMLPreElement>());

  useEffect(() => {
    let active = true;
    guidelineReviewService
      .listDocuments()
      .then((savedDocuments) => {
        if (!active) return;
        setDocuments(savedDocuments);
        if (savedDocuments[0]) {
          setActiveDocumentKey(getDocumentKey(savedDocuments[0]));
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(getErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, []);

  const activeDocument = documents.find(
    (document) => getDocumentKey(document) === activeDocumentKey,
  );

  const ruleCounts = useMemo(() => {
    const counts: Record<GuidelineReviewStatus, number> = {
      PENDING_REVIEW: 0,
      ACCEPTED: 0,
      REJECTED: 0,
    };
    for (const rule of activeDocument?.rules ?? []) {
      counts[rule.reviewStatus] += 1;
    }
    return counts;
  }, [activeDocument]);

  const replaceDocument = (updated: GuidelineDocumentRecord) => {
    const key = getDocumentKey(updated);
    setDocuments((current) =>
      current.map((document) =>
        getDocumentKey(document) === key ? updated : document,
      ),
    );
    setReviewError("");
  };

  const handleFileChange = (file: File | null) => {
    setSelectedFile(file);
    setUploadError("");
    if (file && !title.trim()) {
      setTitle(file.name.replace(/\.pdf$/iu, ""));
    }
  };

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUploadError("");
    if (!selectedFile) {
      setUploadError("Choose a PDF file to upload.");
      return;
    }
    if (!documentId.trim() || !title.trim() || !versionId.trim()) {
      setUploadError("Enter a document ID, title, and version ID.");
      return;
    }

    setIsExtracting(true);
    try {
      const extraction = await guidelineReviewService.extractPdf(selectedFile);
      const draft = GuidelineDocumentRecordSchema.parse({
        documentId: documentId.trim(),
        title: title.trim(),
        versionId: versionId.trim(),
        extraction,
        sections: [],
        rules: [],
      });
      const created = await guidelineReviewService.createDraft(draft);
      setDocuments((current) => [created, ...current]);
      setActiveDocumentKey(getDocumentKey(created));
      setSelection(null);
      setSelectedFile(null);
    } catch (error) {
      setUploadError(getErrorMessage(error));
    } finally {
      setIsExtracting(false);
    }
  };

  const captureSelection = (
    pageNumber: number,
    pageText: string,
  ) => {
    const pageElement = pageTextRefs.current.get(pageNumber);
    const selectedText = window.getSelection();
    const range =
      selectedText && selectedText.rangeCount > 0
        ? selectedText.getRangeAt(0)
        : null;
    const textNode = pageElement?.firstChild;

    if (
      !pageElement ||
      !textNode ||
      textNode.nodeType !== Node.TEXT_NODE ||
      !selectedText ||
      selectedText.isCollapsed ||
      !range ||
      range.startContainer !== textNode ||
      range.endContainer !== textNode
    ) {
      setSelection(null);
      setSelectionError(
        "Select text within a single page to create a source-backed rule.",
      );
      return;
    }

    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    const exactText = pageText.slice(startOffset, endOffset);
    if (
      endOffset <= startOffset ||
      !exactText.trim() ||
      selectedText.toString() !== exactText
    ) {
      setSelection(null);
      setSelectionError("The selection could not be matched to the page text.");
      return;
    }

    setSelectionError("");
    setSelection({
      pageNumber,
      startOffset,
      endOffset,
      text: exactText,
    });
  };

  const addRuleFromSelection = async () => {
    if (!activeDocument || !selection) return;
    const name = sectionName.trim();
    if (!name) {
      setSelectionError("Enter the source section name before adding this rule.");
      return;
    }

    const matchingSection = activeDocument.sections.find(
      (section) => section.name === name,
    );
    const sectionId =
      matchingSection?.sectionId ?? `section-${crypto.randomUUID()}`;
    const sections = matchingSection
      ? activeDocument.sections.map((section) =>
          section.sectionId === sectionId
            ? {
                ...section,
                startPage: Math.min(section.startPage, selection.pageNumber),
                endPage: Math.max(section.endPage, selection.pageNumber),
              }
            : section,
        )
      : [
          ...activeDocument.sections,
          {
            sectionId,
            name,
            startPage: selection.pageNumber,
            endPage: selection.pageNumber,
          },
        ];

    const rule: GuidelineRuleRecord = {
      ruleId: `rule-${crypto.randomUUID()}`,
      sectionId,
      originalText: selection.text,
      reviewStatus: "PENDING_REVIEW",
      source: {
        sourceId: activeDocument.documentId,
        sourceType: "brand_guideline_pdf",
        sourceTitle: activeDocument.title,
        versionId: activeDocument.versionId,
        pageNumber: selection.pageNumber,
        section: name,
        excerpt: selection.text,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
      },
    };

    try {
      const updated = GuidelineDocumentRecordSchema.parse({
        ...activeDocument,
        sections,
        rules: [...activeDocument.rules, rule],
      });
      const saved = await guidelineReviewService.saveDraft(updated);
      replaceDocument(saved);
      setReviewedTextDrafts((current) => ({
        ...current,
        [getRuleDraftKey(saved, rule.ruleId)]: rule.originalText,
      }));
      setSelection(null);
      setSelectionError("");
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      setSelectionError(getErrorMessage(error));
    }
  };

  const updateRule = async (
    rule: GuidelineRuleRecord,
    update: {
      reviewedText?: string;
      reviewStatus?: GuidelineReviewStatus;
    },
  ) => {
    if (!activeDocument) return;
    setBusyRuleId(rule.ruleId);
    setReviewError("");
    try {
      const updated = await guidelineReviewService.updateRule(
        activeDocument.documentId,
        activeDocument.versionId,
        rule.ruleId,
        update,
      );
      replaceDocument(updated);
      const savedReviewedText = update.reviewedText;
      if (savedReviewedText !== undefined) {
        setReviewedTextDrafts((current) => ({
          ...current,
          [getRuleDraftKey(updated, rule.ruleId)]: savedReviewedText,
        }));
      }
    } catch (error) {
      setReviewError(getErrorMessage(error));
    } finally {
      setBusyRuleId("");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1">
            Temporary in-memory review workspace
          </p>
          <h2 className="text-xl font-bold tracking-tight text-[#141414]">
            Guideline PDFs
          </h2>
          <p className="mt-1 text-xs text-[#6B6560]">
            Upload source documents and review rules without changing manual
            knowledge entries.
          </p>
        </div>
        {activeDocument && (
          <div className="rounded-2xl border border-[#E7E1DA] bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B6560]">
              Document approval
            </p>
            <p className="mt-1 text-sm font-bold text-[#7F1D1D]">
              Not approved
            </p>
            <p className="mt-1 text-[11px] text-[#6B6560]">
              Rule decisions do not approve a document version.
            </p>
          </div>
        )}
      </div>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] gap-5 items-start">
        <form
          onSubmit={handleUpload}
          className="bg-white border border-[#E7E1DA] rounded-[24px] p-5 space-y-4"
        >
          <div>
            <h2 className="text-base font-bold text-[#141414]">
              Add a guideline PDF
            </h2>
            <p className="mt-1 text-xs text-[#6B6560]">
              Text extraction runs through the temporary server route. The PDF
              file itself is not retained.
            </p>
          </div>

          {uploadError && (
            <p
              role="alert"
              className="rounded-xl bg-[#F6D5DA]/55 border border-[#EBC3CA] px-3 py-2 text-xs text-[#7F1D1D]"
            >
              {uploadError}
            </p>
          )}

          <label className="block">
            <span className="block text-xs font-semibold text-[#3F3B37] mb-1">
              Document ID
            </span>
            <input
              required
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              placeholder="Enter the document ID"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-[#3F3B37] mb-1">
              Document title
            </span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Brand guideline document title"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-[#3F3B37] mb-1">
              Version ID
            </span>
            <input
              required
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              placeholder="Enter the version ID"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
            />
          </label>

          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#DED6CE] bg-[#FAF8F6] px-4 py-5 text-center hover:border-[#141414]">
            <Upload className="w-5 h-5 text-[#524E4A] mb-2" />
            <span className="text-xs font-semibold text-[#141414]">
              {selectedFile ? selectedFile.name : "Choose a PDF file"}
            </span>
            <span className="mt-1 text-[11px] text-[#6B6560]">
              PDF only · maximum 20 MB
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) =>
                handleFileChange(event.target.files?.[0] ?? null)
              }
              className="sr-only"
            />
          </label>

          <button
            type="submit"
            disabled={isExtracting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#141414] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#2A2A2A] disabled:cursor-wait disabled:opacity-60"
          >
            <FileText className="w-3.5 h-3.5" />
            {isExtracting ? "Extracting PDF…" : "Extract and create draft"}
          </button>
        </form>

        <div className="space-y-4">
          <div className="bg-[#DDF0FA]/70 border border-[#CBE2EF] rounded-[24px] p-5">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 mt-0.5 text-[#24516B] shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-[#141414]">
                  Temporary review behavior
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-[#3F3B37]">
                  Drafts and rule decisions exist only in this browser session.
                  They are not shared, persisted, approved, or available to the
                  governance engine.
                </p>
              </div>
            </div>
          </div>

          {loadError && (
            <p role="alert" className="text-xs text-[#7F1D1D]">
              Could not load in-memory drafts: {loadError}
            </p>
          )}

          {documents.length > 0 && (
            <label className="block bg-white border border-[#E7E1DA] rounded-2xl p-4">
              <span className="block text-xs font-semibold text-[#3F3B37] mb-1.5">
                In-memory guideline drafts
              </span>
              <select
                value={activeDocumentKey}
                onChange={(event) => {
                  setActiveDocumentKey(event.target.value);
                  setSelection(null);
                  setSelectionError("");
                }}
                className="w-full rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] px-3 py-2 text-sm text-[#141414]"
              >
                {documents.map((document) => (
                  <option
                    key={getDocumentKey(document)}
                    value={getDocumentKey(document)}
                  >
                    {document.title} · {document.versionId}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!activeDocument && (
            <div className="rounded-[24px] border border-[#E7E1DA] bg-white p-8 text-center">
              <FileText className="mx-auto h-7 w-7 text-[#8E8780]" />
              <p className="mt-3 text-sm font-semibold text-[#141414]">
                No guideline draft in this session
              </p>
              <p className="mt-1 text-xs text-[#6B6560]">
                Upload a PDF and enter its document and version metadata to
                begin.
              </p>
            </div>
          )}
        </div>
      </section>

      {activeDocument && (
        <div className="space-y-6">
          <section className="bg-white border border-[#E7E1DA] rounded-[24px] p-5">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
              <div className="min-w-0">
                <p className="text-xs text-[#6B6560]">
                  {activeDocument.extraction.fileName}
                </p>
                <h2 className="mt-1 text-xl font-bold text-[#141414]">
                  {activeDocument.title}
                </h2>
                <p className="mt-1 text-xs text-[#524E4A]">
                  Document ID: {activeDocument.documentId} · Version:{" "}
                  {activeDocument.versionId} ·{" "}
                  {activeDocument.extraction.totalPageCount} pages
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 shrink-0">
                <StatusCount
                  label="Pending"
                  count={ruleCounts.PENDING_REVIEW}
                  className="bg-[#FAF0C8] border-[#E9DFAF] text-[#664D03]"
                />
                <StatusCount
                  label="Accepted"
                  count={ruleCounts.ACCEPTED}
                  className="bg-[#CDEEE0] border-[#BAE0D0] text-[#14532D]"
                />
                <StatusCount
                  label="Rejected"
                  count={ruleCounts.REJECTED}
                  className="bg-[#F6D5DA] border-[#EBC3CA] text-[#7F1D1D]"
                />
              </div>
            </div>

            {activeDocument.extraction.notice && (
              <p className="mt-4 rounded-xl border border-[#E9DFAF] bg-[#FAF0C8]/60 px-3 py-2 text-xs text-[#664D03]">
                {activeDocument.extraction.notice}
              </p>
            )}
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#141414]">
                  Extracted PDF text
                </h2>
                <p className="mt-1 text-xs text-[#6B6560]">
                  Select an exact passage within one page to add it as a
                  source-backed rule. No automatic rule classification is
                  performed.
                </p>
              </div>

              {selectionError && (
                <p role="alert" className="text-xs text-[#7F1D1D]">
                  {selectionError}
                </p>
              )}

              {selection && (
                <div className="bg-[#E2DBFB]/60 border border-[#D3CAEE] rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#141414]">
                    Selected page {selection.pageNumber}: “{selection.text}”
                  </p>
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                      Source section
                    </span>
                    <input
                      value={sectionName}
                      onChange={(event) => setSectionName(event.target.value)}
                      placeholder="Enter the section name shown in the PDF"
                      className="w-full rounded-xl border border-[#E7E1DA] bg-white px-3 py-2 text-xs text-[#141414]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={addRuleFromSelection}
                    className="rounded-full bg-[#141414] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2A2A2A]"
                  >
                    Add selected text as rule
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {activeDocument.extraction.pages.map((page) => (
                  <details
                    key={page.pageNumber}
                    className="overflow-hidden rounded-[20px] border border-[#E7E1DA] bg-white"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#F3EDE8]/70 px-4 py-3">
                      <span className="text-sm font-semibold text-[#141414]">
                        Page {page.pageNumber}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${
                          page.status === "TEXT_EXTRACTED"
                            ? "text-[#14532D]"
                            : "text-[#664D03]"
                        }`}
                      >
                        {page.status === "TEXT_EXTRACTED"
                          ? "Text extracted"
                          : "No extractable text"}
                      </span>
                    </summary>
                    {page.text ? (
                      <pre
                        ref={(element) => {
                          if (element) {
                            pageTextRefs.current.set(page.pageNumber, element);
                          } else {
                            pageTextRefs.current.delete(page.pageNumber);
                          }
                        }}
                        onMouseUp={() =>
                          captureSelection(page.pageNumber, page.text)
                        }
                        onKeyUp={() =>
                          captureSelection(page.pageNumber, page.text)
                        }
                        className="select-text whitespace-pre-wrap break-words px-4 py-4 text-xs leading-relaxed text-[#2B2927] font-sans"
                      >
                        {page.text}
                      </pre>
                    ) : (
                      <p className="px-4 py-4 text-xs text-[#6B6560]">
                        This page has no extractable text. OCR was not
                        performed.
                      </p>
                    )}
                  </details>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-[#141414]">
                  Guideline rules
                </h2>
                <p className="mt-1 text-xs text-[#6B6560]">
                  Review decisions apply to individual rules only. Source text
                  and references remain unchanged when reviewed text is edited.
                </p>
              </div>

              {ruleCounts.PENDING_REVIEW === 0 &&
                activeDocument.rules.length > 0 && (
                  <p className="rounded-xl border border-[#E9DFAF] bg-[#FAF0C8]/60 px-3 py-2 text-xs text-[#664D03]">
                    All rules have an individual decision. The document version
                    is still not approved.
                  </p>
                )}

              {reviewError && (
                <p role="alert" className="text-xs text-[#7F1D1D]">
                  {reviewError}
                </p>
              )}

              {activeDocument.rules.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[#D3CCC4] bg-white p-7 text-center">
                  <p className="text-sm font-semibold text-[#141414]">
                    No rules added yet
                  </p>
                  <p className="mt-1 text-xs text-[#6B6560]">
                    Select a passage in the extracted text and name its source
                    section to create a rule.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeDocument.rules.map((rule, index) => {
                    const draftKey = getRuleDraftKey(activeDocument, rule.ruleId);
                    const reviewedText =
                      reviewedTextDrafts[draftKey] ??
                      rule.reviewedText ??
                      rule.originalText;
                    const isBusy = busyRuleId === rule.ruleId;

                    return (
                      <article
                        key={rule.ruleId}
                        className="rounded-[20px] border border-[#E7E1DA] bg-white p-4 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-medium text-[#6B6560]">
                              Rule {index + 1} · {rule.source.section} · Page{" "}
                              {rule.source.pageNumber}
                            </p>
                            <h3 className="mt-1 text-sm font-bold text-[#141414]">
                              {REVIEW_STATUS_LABEL[rule.reviewStatus]}
                            </h3>
                          </div>
                          <RuleStatusIcon status={rule.reviewStatus} />
                        </div>

                        <div className="rounded-xl border border-[#D3CAEE] bg-[#E2DBFB]/45 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#524E4A]">
                            Exact source excerpt
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#2B2927]">
                            {rule.source.excerpt}
                          </p>
                          <p className="mt-2 text-[10px] text-[#6B6560]">
                            {rule.source.sourceTitle} · version{" "}
                            {rule.source.versionId} · page{" "}
                            {rule.source.pageNumber} · section{" "}
                            {rule.source.section}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold text-[#3F3B37] mb-1">
                            Original extracted text (unchanged)
                          </p>
                          <p className="whitespace-pre-wrap rounded-xl bg-[#FAF8F6] px-3 py-2 text-xs leading-relaxed text-[#3F3B37]">
                            {rule.originalText}
                          </p>
                        </div>

                        <label className="block">
                          <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                            Reviewed text
                          </span>
                          <textarea
                            rows={3}
                            value={reviewedText}
                            onChange={(event) =>
                              setReviewedTextDrafts((current) => ({
                                ...current,
                                [draftKey]: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-[#E7E1DA] bg-white px-3 py-2 text-xs leading-relaxed text-[#141414] focus:outline-none focus:border-[#141414]"
                          />
                        </label>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE7] pt-3">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updateRule(rule, { reviewedText })
                            }
                            className="rounded-full border border-[#E7E1DA] px-3.5 py-2 text-xs font-semibold text-[#3F3B37] hover:bg-[#FAF8F6] disabled:opacity-50"
                          >
                            Save edit
                          </button>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                updateRule(rule, {
                                  reviewedText,
                                  reviewStatus: "REJECTED",
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-full bg-[#F6D5DA]/70 px-3.5 py-2 text-xs font-semibold text-[#7F1D1D] hover:bg-[#F6D5DA] disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject rule
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                updateRule(rule, {
                                  reviewedText,
                                  reviewStatus: "ACCEPTED",
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-full bg-[#CDEEE0] px-3.5 py-2 text-xs font-semibold text-[#14532D] hover:brightness-95 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Accept rule
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatusCount({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <div className={`min-w-[72px] rounded-xl border px-3 py-2 ${className}`}>
      <p className="text-lg font-bold tabular-nums">{count}</p>
      <p className="text-[10px] font-medium">{label}</p>
    </div>
  );
}

function RuleStatusIcon({ status }: { status: GuidelineReviewStatus }) {
  if (status === "ACCEPTED") {
    return <CheckCircle2 className="w-4 h-4 text-[#14532D]" aria-hidden="true" />;
  }
  if (status === "REJECTED") {
    return <AlertTriangle className="w-4 h-4 text-[#7F1D1D]" aria-hidden="true" />;
  }
  return <Clock3 className="w-4 h-4 text-[#664D03]" aria-hidden="true" />;
}
