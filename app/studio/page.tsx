"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileWarning,
  HelpCircle,
  Layers,
  MessageSquare,
  Plus,
  ScanText,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Type as TypeIcon,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { EVIDENCE_STYLE, REVIEW_STATUS_META, SEVERITY_LABEL } from "@/components/ThemeTokens";
import {
  EvidenceStatus,
  FindingCategory,
  FindingSeverity,
  ReviewFinding,
} from "@/lib/types";

const CATEGORY_TOOLBAR: Array<{
  label: string;
  category: "All" | FindingCategory;
  pastelBg: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { label: "All", category: "All", pastelBg: "bg-[#E2DBFB]", icon: Layers },
  { label: "Claims", category: "Brand Claims", pastelBg: "bg-[#F6D5DA]", icon: ShieldAlert },
  { label: "Terms", category: "Terminology", pastelBg: "bg-[#DDF0FA]", icon: TypeIcon },
  { label: "Tone", category: "Tone & Voice", pastelBg: "bg-[#FAF0C8]", icon: MessageSquare },
  { label: "Visual", category: "Visual Identity", pastelBg: "bg-[#CDEEE0]", icon: Eye },
  { label: "Legal", category: "Legal & Usage", pastelBg: "bg-[#F9DEC0]", icon: FileWarning },
];

type DomainFilter = "all" | "text" | "visual";

function isVisualFinding(f: ReviewFinding): boolean {
  return (
    f.sourceDomain === "visual" ||
    f.category === "Visual Identity" ||
    Boolean(f.location?.boundingBox)
  );
}

function ReviewStudioInner() {
  const searchParams = useSearchParams();
  const {
    reviews,
    activeReviewId,
    setActiveReviewId,
    toggleFindingResolved,
    updateFindingCorrection,
    addFindingComment,
    addManualFinding,
    updateReviewStatus,
  } = useIdentiq();

  const urlReviewId = searchParams.get("id");

  useEffect(() => {
    if (urlReviewId && reviews.some((r) => r.id === urlReviewId)) {
      setActiveReviewId(urlReviewId);
    }
  }, [urlReviewId, reviews, setActiveReviewId]);

  const activeReview = useMemo(
    () => reviews.find((r) => r.id === activeReviewId) || reviews[0],
    [reviews, activeReviewId]
  );

  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<"All" | FindingCategory>("All");
  const [evidenceFilter, setEvidenceFilter] = useState<"All" | EvidenceStatus>("All");
  const [severityFilter, setSeverityFilter] = useState<"All" | FindingSeverity>("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string>("");
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [showOcrBoxes, setShowOcrBoxes] = useState(false);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, string>>({});
  const [commentText, setCommentText] = useState("");
  const [compactDensity, setCompactDensity] = useState(false);

  // Manual finding modal
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualCategory, setManualCategory] = useState<FindingCategory>("Brand Claims");
  const [manualSeverity, setManualSeverity] = useState<FindingSeverity>("medium");
  const [manualEvidence, setManualEvidence] = useState<EvidenceStatus>("unverified");
  const [manualDesc, setManualDesc] = useState("");
  const [manualRec, setManualRec] = useState("");

  const filteredFindings = useMemo(() => {
    if (!activeReview) return [];
    return activeReview.findings.filter((f) => {
      const visual = isVisualFinding(f);
      const domMatch =
        domainFilter === "all" ||
        (domainFilter === "visual" && visual) ||
        (domainFilter === "text" && !visual);
      const catMatch = categoryFilter === "All" || f.category === categoryFilter;
      const evMatch = evidenceFilter === "All" || f.evidenceStatus === evidenceFilter;
      const sevMatch = severityFilter === "All" || f.severity === severityFilter;
      const q = searchTerm.trim().toLowerCase();
      const textMatch =
        !q ||
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.sourceReference.toLowerCase().includes(q) ||
        f.affectedContent.toLowerCase().includes(q);
      return domMatch && catMatch && evMatch && sevMatch && textMatch;
    });
  }, [activeReview, domainFilter, categoryFilter, evidenceFilter, severityFilter, searchTerm]);

  const selectedFinding = useMemo(() => {
    if (!activeReview) return null;
    return (
      activeReview.findings.find((f) => f.id === selectedFindingId) ||
      filteredFindings[0] ||
      activeReview.findings[0] ||
      null
    );
  }, [activeReview, selectedFindingId, filteredFindings]);

  const pages = activeReview?.visualSummary?.pages ?? [];
  const totalPages = pages.length || 1;
  const clampedPageNumber = Math.max(1, Math.min(totalPages, activePageNumber));
  const currentPageObj = pages.find((p) => p.pageNumber === clampedPageNumber);
  const currentPageImageUrl = currentPageObj?.previewDataUrl ?? activeReview?.assetUrl;

  const pageOcrBlocks = useMemo(() => {
    if (!activeReview?.ocrBlocks) return [];
    return activeReview.ocrBlocks.filter((b) => b.pageNumber === clampedPageNumber);
  }, [activeReview, clampedPageNumber]);

  const handleSelectFinding = (finding: ReviewFinding) => {
    setSelectedFindingId(finding.id);
    if (finding.location?.pageNumber) {
      setActivePageNumber(finding.location.pageNumber);
    }
  };

  const correctionDraft = selectedFinding
    ? correctionDrafts[selectedFinding.id] ??
      selectedFinding.editedCorrection ??
      selectedFinding.expectedValue
    : "";

  const setCorrectionDraft = (val: string) => {
    if (!selectedFinding) return;
    setCorrectionDrafts((prev) => ({ ...prev, [selectedFinding.id]: val }));
  };

  if (!activeReview) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold">No reviews available yet.</p>
      </div>
    );
  }

  const totalFindings = activeReview.findings.length;
  const visualFindingsCount = activeReview.findings.filter(isVisualFinding).length;
  const textFindingsCount = totalFindings - visualFindingsCount;
  const resolvedOrSupported = activeReview.findings.filter(
    (f) => f.resolved || f.evidenceStatus === "supported"
  ).length;
  const openOrUnverified = activeReview.findings.filter((f) => !f.resolved).length;
  const statusMeta = REVIEW_STATUS_META[activeReview.status];

  const renderHighlightedCopy = () => {
    const copy = activeReview.textContent;
    if (!copy) {
      return (
        <p className="text-xs text-[#6B6560] italic">
          No text copy submitted or extracted for this creative.
        </p>
      );
    }
    const phrase = selectedFinding?.affectedContent?.trim();
    if (!phrase || !copy.toLowerCase().includes(phrase.toLowerCase())) {
      return <p className="text-sm text-[#2B2927] leading-relaxed whitespace-pre-wrap">{copy}</p>;
    }

    const idx = copy.toLowerCase().indexOf(phrase.toLowerCase());
    const before = copy.slice(0, idx);
    const match = copy.slice(idx, idx + phrase.length);
    const after = copy.slice(idx + phrase.length);

    const highlightClass =
      selectedFinding?.evidenceStatus === "conflicting"
        ? "bg-[#F6D5DA] text-[#7F1D1D]"
        : selectedFinding?.evidenceStatus === "unverified"
        ? "bg-[#FAF0C8] text-[#664D03]"
        : "bg-[#CDEEE0] text-[#14532D]";

    return (
      <p className="text-sm text-[#2B2927] leading-relaxed whitespace-pre-wrap">
        {before}
        <mark className={`${highlightClass} px-1.5 py-0.5 rounded-md font-semibold`}>
          {match}
        </mark>
        {after}
      </p>
    );
  };

  const handleAddManualFinding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim() || !manualDesc.trim()) return;
    const item: ReviewFinding = {
      id: `f-manual-${Date.now()}`,
      category: manualCategory,
      title: manualTitle.trim(),
      description: manualDesc.trim(),
      severity: manualSeverity,
      evidenceStatus: manualEvidence,
      detectedValue: "Manual reviewer observation",
      expectedValue: manualRec.trim() || "Align with brand guidelines",
      sourceReference: `${activeReview.guidelineCollection} · Manual Audit`,
      recommendation: manualRec.trim() || "Update asset or copy prior to release.",
      affectedContent: "",
      resolved: false,
      comments: [],
      sourceDomain: manualCategory === "Visual Identity" ? "visual" : "text",
    };
    addManualFinding(activeReview.id, item);
    setSelectedFindingId(item.id);
    setManualOpen(false);
    setManualTitle("");
    setManualDesc("");
    setManualRec("");
  };

  const renderEvidenceIcon = (status: EvidenceStatus) => {
    if (status === "supported") return <CheckCircle2 className="w-4 h-4 text-[#0F5132]" />;
    if (status === "conflicting") return <AlertTriangle className="w-4 h-4 text-[#842029]" />;
    return <HelpCircle className="w-4 h-4 text-[#664D03]" />;
  };

  const selectedBoxOnCurrentPage =
    selectedFinding?.location?.boundingBox &&
    (!selectedFinding.location.pageNumber ||
      selectedFinding.location.pageNumber === clampedPageNumber)
      ? selectedFinding.location.boundingBox
      : null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#F7F6F3] flex flex-col">
      <div className="flex-1 max-w-[1520px] w-full mx-auto px-4 sm:px-6 py-5 pb-24">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left / Center Split Area */}
          <div className="xl:col-span-8 flex gap-4 items-start">
            {/* Left Vertical Floating Tool Strip */}
            <div className="hidden sm:flex flex-col justify-between items-center gap-4 shrink-0 sticky top-20">
              <div className="bg-white border border-[#E7E1DA] rounded-full p-1.5 flex flex-col gap-1.5 shadow-xs">
                {CATEGORY_TOOLBAR.map((item) => {
                  const Icon = item.icon;
                  const active = categoryFilter === item.category;
                  return (
                    <button
                      key={item.category}
                      type="button"
                      title={item.label}
                      aria-label={`Filter category ${item.label}`}
                      onClick={() => setCategoryFilter(item.category)}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                        active
                          ? "bg-[#141414] text-white"
                          : "text-[#524E4A] hover:bg-[#FAF8F6] hover:text-[#141414]"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>

              <div className="bg-white border border-[#E7E1DA] rounded-full p-1.5 flex flex-col gap-1 shadow-xs">
                <button
                  type="button"
                  title="Comfortable view"
                  aria-label="Comfortable view"
                  onClick={() => setCompactDensity(false)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    !compactDensity ? "bg-[#FAF8F6] text-[#141414]" : "text-[#6B6560]"
                  }`}
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Compact view"
                  aria-label="Compact view"
                  onClick={() => setCompactDensity(true)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    compactDensity ? "bg-[#FAF8F6] text-[#141414]" : "text-[#6B6560]"
                  }`}
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main Studio Center Column */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Top Studio Controls + KPI Counters */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B6560] mb-1">
                    <span>{activeReview.contentType}</span>
                    <span>·</span>
                    <span>{activeReview.guidelineCollection}</span>
                    <span>·</span>
                    <span className={`font-semibold ${statusMeta.textColor}`}>
                      {statusMeta.label}
                    </span>
                    {activeReview.analysisStatus === "PARTIAL" && (
                      <>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded-full bg-[#FAF0C8] text-[#664D03] font-semibold text-[11px]">
                          Partial Review
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#141414]">
                      Review Studio
                    </h1>
                    <select
                      aria-label="Switch active review"
                      value={activeReview.id}
                      onChange={(e) => {
                        setActiveReviewId(e.target.value);
                        setSelectedFindingId("");
                        setActivePageNumber(1);
                      }}
                      className="px-3 py-1.5 rounded-full bg-white border border-[#E7E1DA] text-xs font-semibold text-[#141414] max-w-[260px]"
                    >
                      {reviews.map((rev) => (
                        <option key={rev.id} value={rev.id}>
                          {rev.title} ({rev.complianceScore}%)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Search + 3 KPI Counter Tiles */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#6B6560] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      aria-label="Search findings"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search findings..."
                      className="pl-8 pr-3 py-2 rounded-full bg-white border border-[#E7E1DA] text-xs text-[#141414] w-44 focus:outline-none focus:border-[#141414]"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setEvidenceFilter("All")}
                    className="bg-[#DDF0FA] border border-[#CBE2EF] rounded-2xl px-4 py-2 text-center min-w-[76px]"
                  >
                    <p className="text-lg font-bold text-[#141414] leading-none tabular-nums">
                      {totalFindings}
                    </p>
                    <p className="text-[11px] text-[#3F3B37] mt-1">Total</p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEvidenceFilter(evidenceFilter === "supported" ? "All" : "supported")
                    }
                    className="bg-[#CDEEE0] border border-[#BAE0D0] rounded-2xl px-4 py-2 text-center min-w-[82px]"
                  >
                    <p className="text-lg font-bold text-[#141414] leading-none tabular-nums">
                      {resolvedOrSupported}
                    </p>
                    <p className="text-[11px] text-[#14532D] mt-1">Supported</p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEvidenceFilter(evidenceFilter === "unverified" ? "All" : "unverified")
                    }
                    className="bg-white/70 border-2 border-dashed border-[#D3CCC4] rounded-2xl px-4 py-2 text-center min-w-[78px]"
                  >
                    <p className="text-lg font-bold text-[#141414] leading-none tabular-nums">
                      {openOrUnverified}
                    </p>
                    <p className="text-[11px] text-[#524E4A] mt-1">Open</p>
                  </button>
                </div>
              </div>

              {/* Partial Processing Warning Banner */}
              {activeReview.visualSummary &&
                (activeReview.visualSummary.warnings.length > 0 ||
                  activeReview.visualSummary.errors.length > 0) && (
                  <div
                    role="status"
                    className="bg-[#FAF0C8]/80 border border-[#E7D89E] rounded-2xl p-3.5 text-xs text-[#664D03] space-y-1"
                  >
                    <p className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      Visual Pipeline Notices ({activeReview.visualSummary.status})
                    </p>
                    {activeReview.visualSummary.errors.map((err, i) => (
                      <p key={`err-${i}`} className="text-[#842029] font-medium">
                        • {err}
                      </p>
                    ))}
                    {activeReview.visualSummary.warnings.slice(0, 3).map((warn, i) => (
                      <p key={`warn-${i}`}>• {warn}</p>
                    ))}
                  </div>
                )}

              {/* Submitted Creative & Copy Preview Card */}
              <div className="bg-white border border-[#E7E1DA] rounded-[24px] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-[#EFECE7]">
                  <div>
                    <h2 className="text-base font-bold text-[#141414]">{activeReview.title}</h2>
                    <p className="text-xs text-[#6B6560] tabular-nums">
                      Submitted by {activeReview.submittedBy} · {activeReview.submittedAt} ·
                      Compliance Score: {activeReview.complianceScore}%
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateReviewStatus(activeReview.id, "Changes Requested")}
                      className="px-3.5 py-1.5 rounded-full border border-[#E7E1DA] bg-[#F6D5DA]/50 hover:bg-[#F6D5DA] text-xs font-semibold text-[#7F1D1D] transition-colors whitespace-nowrap"
                    >
                      Request Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => updateReviewStatus(activeReview.id, "Approved")}
                      className="px-4 py-1.5 rounded-full bg-[#141414] hover:bg-[#2B2B2B] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                    >
                      Approve Content
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                  {(currentPageImageUrl || pages.length > 0) && (
                    <div className="md:col-span-6 space-y-2">
                      {/* Page navigation bar for multi-page PDFs or visual previews */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {pages.length > 1 && (
                            <>
                              <button
                                type="button"
                                aria-label="Previous page"
                                disabled={clampedPageNumber <= 1}
                                onClick={() => setActivePageNumber((p) => Math.max(1, p - 1))}
                                className="p-1 rounded-full border border-[#E7E1DA] bg-[#FAF8F6] disabled:opacity-40"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-semibold text-[#141414] tabular-nums">
                                Page {clampedPageNumber} / {totalPages}
                              </span>
                              <button
                                type="button"
                                aria-label="Next page"
                                disabled={clampedPageNumber >= totalPages}
                                onClick={() =>
                                  setActivePageNumber((p) => Math.min(totalPages, p + 1))
                                }
                                className="p-1 rounded-full border border-[#E7E1DA] bg-[#FAF8F6] disabled:opacity-40"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {pages.length <= 1 && (
                            <span className="text-[11px] font-semibold text-[#6B6560]">
                              Creative Evidence Preview
                            </span>
                          )}
                        </div>

                        {pageOcrBlocks.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowOcrBoxes((v) => !v)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${
                              showOcrBoxes
                                ? "bg-[#141414] text-white border-[#141414]"
                                : "bg-[#FAF8F6] text-[#3F3B37] border-[#E7E1DA]"
                            }`}
                          >
                            <ScanText className="w-3 h-3" />
                            OCR Regions ({pageOcrBlocks.length})
                          </button>
                        )}
                      </div>

                      {currentPageObj?.status === "failed" ? (
                        <div className="rounded-2xl border border-[#EBC3CA] bg-[#F6D5DA]/40 p-6 text-center space-y-1.5">
                          <AlertTriangle className="w-5 h-5 text-[#842029] mx-auto" />
                          <p className="text-xs font-bold text-[#842029]">
                            Page {clampedPageNumber} failed to render
                          </p>
                          <p className="text-[11px] text-[#7F1D1D]">
                            {currentPageObj.error || "Page processing error."}
                          </p>
                        </div>
                      ) : currentPageImageUrl ? (
                        <div className="relative w-full rounded-2xl border border-[#E7E1DA] overflow-hidden bg-[#FAF8F6]">
                          <img
                            src={currentPageImageUrl}
                            alt={`${activeReview.assetName || activeReview.title} page ${clampedPageNumber}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-auto block"
                          />

                          {/* Optional OCR bounding boxes */}
                          {showOcrBoxes &&
                            pageOcrBlocks.map((block, i) => (
                              <div
                                key={`ocr-box-${i}`}
                                title={`${block.source.toUpperCase()} (${Math.round(
                                  block.confidence * 100,
                                )}%): ${block.text}`}
                                style={{
                                  left: `${block.boundingBox.x * 100}%`,
                                  top: `${block.boundingBox.y * 100}%`,
                                  width: `${block.boundingBox.width * 100}%`,
                                  height: `${block.boundingBox.height * 100}%`,
                                }}
                                className={`absolute pointer-events-none border ${
                                  block.uncertain
                                    ? "border-dashed border-amber-600 bg-amber-400/15"
                                    : "border-sky-600/70 bg-sky-400/10"
                                }`}
                              />
                            ))}

                          {/* Highlighted Finding Evidence Bounding Box */}
                          {selectedBoxOnCurrentPage && selectedFinding && (
                            <div
                              data-testid="evidence-bounding-box"
                              style={{
                                left: `${selectedBoxOnCurrentPage.x * 100}%`,
                                top: `${selectedBoxOnCurrentPage.y * 100}%`,
                                width: `${selectedBoxOnCurrentPage.width * 100}%`,
                                height: `${selectedBoxOnCurrentPage.height * 100}%`,
                              }}
                              className={`absolute pointer-events-none rounded-md border-2 transition-all ${
                                selectedFinding.evidenceStatus === "conflicting"
                                  ? "border-[#BE123C] bg-[#F43F5E]/15"
                                  : selectedFinding.evidenceStatus === "unverified"
                                    ? "border-[#B45309] bg-[#F59E0B]/15"
                                    : "border-[#047857] bg-[#10B981]/15"
                              }`}
                            >
                              <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-[#141414] text-white text-[10px] font-semibold whitespace-nowrap shadow">
                                {selectedFinding.ruleId || selectedFinding.category}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {activeReview.assetName && (
                        <p className="text-[11px] font-mono text-[#6B6560] truncate">
                          {activeReview.assetName}
                          {currentPageObj
                            ? ` · ${currentPageObj.imageWidth}×${currentPageObj.imageHeight}px · rot ${currentPageObj.rotation}°`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}

                  <div
                    className={
                      currentPageImageUrl || pages.length > 0
                        ? "md:col-span-6"
                        : "md:col-span-12"
                    }
                  >
                    <p className="text-[11px] font-semibold text-[#6B6560] mb-1.5">
                      Submitted / Extracted Copy (highlighted for selected finding)
                    </p>
                    <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4 max-h-[380px] overflow-y-auto">
                      {renderHighlightedCopy()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Domain + Evidence + Severity Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { key: "all", label: `All (${totalFindings})` },
                      { key: "text", label: `Text (${textFindingsCount})` },
                      { key: "visual", label: `Visual (${visualFindingsCount})` },
                    ] as const
                  ).map((dom) => (
                    <button
                      key={dom.key}
                      type="button"
                      onClick={() => setDomainFilter(dom.key)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        domainFilter === dom.key
                          ? "bg-[#141414] text-white border-[#141414]"
                          : "bg-white text-[#141414] border-[#E7E1DA] hover:bg-[#F3EDE8]"
                      }`}
                    >
                      {dom.label}
                    </button>
                  ))}

                  <span className="w-px h-4 bg-[#DED6CE] mx-1" />

                  {(["All", "conflicting", "unverified", "supported"] as const).map((ev) => (
                    <button
                      key={ev}
                      type="button"
                      onClick={() => setEvidenceFilter(ev)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        evidenceFilter === ev
                          ? "bg-[#141414] text-white border-[#141414]"
                          : "bg-white text-[#524E4A] border-[#E7E1DA] hover:bg-[#F3EDE8]"
                      }`}
                    >
                      {ev === "All"
                        ? "All Evidence"
                        : ev === "conflicting"
                        ? "Conflicting"
                        : ev === "unverified"
                        ? "Unverified"
                        : "Supported"}
                    </button>
                  ))}

                  <select
                    aria-label="Filter by severity"
                    value={severityFilter}
                    onChange={(e) =>
                      setSeverityFilter(e.target.value as "All" | FindingSeverity)
                    }
                    className="px-3 py-1.5 rounded-full bg-white border border-[#E7E1DA] text-xs font-medium text-[#524E4A]"
                  >
                    <option value="All">All Severities</option>
                    <option value="high">High Severity</option>
                    <option value="medium">Medium Severity</option>
                    <option value="low">Low Severity</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E7E1DA] text-xs font-semibold text-[#141414] hover:bg-[#F3EDE8]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Finding
                </button>
              </div>

              {/* Findings List */}
              {filteredFindings.length === 0 ? (
                <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-8 text-center">
                  <p className="text-sm font-semibold text-[#141414]">
                    No findings match the current filter
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDomainFilter("all");
                      setCategoryFilter("All");
                      setEvidenceFilter("All");
                      setSeverityFilter("All");
                      setSearchTerm("");
                    }}
                    className="mt-3 px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold"
                  >
                    Show All Findings
                  </button>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {filteredFindings.map((finding) => {
                    const isSelected = selectedFinding?.id === finding.id;
                    const evMeta = EVIDENCE_STYLE[finding.evidenceStatus];
                    const visual = isVisualFinding(finding);
                    return (
                      <div
                        key={finding.id}
                        onClick={() => handleSelectFinding(finding)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectFinding(finding);
                          }
                        }}
                        className={`cursor-pointer bg-white rounded-[22px] transition-all border ${
                          isSelected
                            ? "border-[#141414] ring-1 ring-[#141414]"
                            : "border-[#E7E1DA] hover:border-[#BDB5AC]"
                        } ${compactDensity ? "p-4" : "p-5"}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  visual
                                    ? "bg-[#CDEEE0] text-[#14532D]"
                                    : "bg-[#E2DBFB] text-[#2B2927]"
                                }`}
                              >
                                {visual ? "Visual" : "Text"}
                              </span>
                              <span className="font-semibold text-[#141414]">
                                {finding.category}
                              </span>
                              <span className="text-[#8E8780]">·</span>
                              <span className="text-[#524E4A]">
                                {SEVERITY_LABEL[finding.severity]}
                              </span>
                              <span className="text-[#8E8780]">·</span>
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${evMeta.textClass}`}
                              >
                                {renderEvidenceIcon(finding.evidenceStatus)}
                                {evMeta.label}
                              </span>
                              {finding.location?.pageNumber && (
                                <>
                                  <span className="text-[#8E8780]">·</span>
                                  <span className="text-[#524E4A] font-medium">
                                    Page {finding.location.pageNumber}
                                  </span>
                                </>
                              )}
                              {finding.requiresHumanReview && (
                                <span className="px-2 py-0.5 rounded-full bg-[#FAF0C8] text-[#664D03] text-[11px] font-semibold">
                                  Needs Human Review
                                </span>
                              )}
                            </div>

                            <h3 className="text-base font-bold text-[#141414]">
                              {finding.title}
                            </h3>
                            {!compactDensity && (
                              <p className="text-xs text-[#524E4A] leading-relaxed">
                                {finding.description}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFindingResolved(activeReview.id, finding.id);
                              }}
                              aria-label={
                                finding.resolved ? "Reopen finding" : "Mark finding resolved"
                              }
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                                finding.resolved
                                  ? "bg-[#CDEEE0] text-[#14532D]"
                                  : "bg-[#141414] text-white hover:bg-[#2B2B2B]"
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                              {finding.resolved ? "Resolved" : "Resolve"}
                            </button>
                          </div>
                        </div>

                        {finding.affectedContent && (
                          <div className="mt-3 pt-3 border-t border-[#F0ECE7] flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="text-[#6B6560] truncate max-w-full">
                              Observed:{" "}
                              <span className="font-mono text-[#141414]">
                                &ldquo;{finding.affectedContent}&rdquo;
                              </span>
                            </span>
                            <span className="text-[#6B6560] text-[11px]">
                              {finding.confidence !== undefined
                                ? `Confidence ${Math.round(finding.confidence * 100)}% · `
                                : ""}
                              {finding.comments.length} comments
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right-Side Evidence & Corrections Panel */}
          <aside className="xl:col-span-4 bg-white border border-[#E7E1DA] rounded-[26px] p-5 space-y-4 sticky top-20">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#141414]">Evidence &amp; Corrections</h2>
              {selectedFinding && (
                <span className="text-xs font-medium text-[#6B6560]">
                  {selectedFinding.resolved ? "Resolved" : "Action Needed"}
                </span>
              )}
            </div>

            {!selectedFinding ? (
              <p className="text-xs text-[#6B6560] py-8 text-center">
                Select any finding from the canvas to inspect evidence and recommended edits.
              </p>
            ) : (
              <div className="space-y-3.5">
                {/* Card 1: Evidence State & Detected vs Expected */}
                <div
                  className={`${EVIDENCE_STYLE[selectedFinding.evidenceStatus].cardBg} border ${
                    EVIDENCE_STYLE[selectedFinding.evidenceStatus].cardBorder
                  } rounded-2xl p-4 space-y-2.5`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#141414]">
                      {renderEvidenceIcon(selectedFinding.evidenceStatus)}
                      {EVIDENCE_STYLE[selectedFinding.evidenceStatus].label}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#3F3B37]">
                      {selectedFinding.confidence !== undefined && (
                        <span>{Math.round(selectedFinding.confidence * 100)}% conf.</span>
                      )}
                      {selectedFinding.detector && (
                        <span className="px-2 py-0.5 rounded-full bg-white/70 border border-black/10">
                          {selectedFinding.detector}
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedFinding.requiresHumanReview && (
                    <p className="text-[11px] font-semibold text-[#664D03] bg-white/60 rounded-lg px-2.5 py-1.5">
                      Human inspection required — not a confirmed violation.
                    </p>
                  )}

                  <div className="text-xs space-y-1.5">
                    <div>
                      <span className="font-semibold text-[#3F3B37]">Observed: </span>
                      <span className="text-[#141414]">{selectedFinding.detectedValue}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[#3F3B37]">Expected: </span>
                      <span className="text-[#141414]">{selectedFinding.expectedValue}</span>
                    </div>
                    {selectedFinding.location?.pageNumber && (
                      <div>
                        <span className="font-semibold text-[#3F3B37]">Creative Location: </span>
                        <span className="text-[#141414]">
                          Page {selectedFinding.location.pageNumber}
                          {selectedFinding.location.boundingBox
                            ? ` · Box (${Math.round(
                                selectedFinding.location.boundingBox.x * 100,
                              )}%, ${Math.round(selectedFinding.location.boundingBox.y * 100)}%)`
                            : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card 2: Source Guideline Reference */}
                <div className="bg-[#E2DBFB]/70 border border-[#D3CAEE] rounded-2xl p-4 space-y-1.5">
                  <p className="text-[11px] font-bold text-[#141414]">
                    Source Guideline Reference {selectedFinding.ruleId ? `· ${selectedFinding.ruleId}` : ""}
                  </p>
                  <p className="text-xs font-semibold text-[#2B2927]">
                    {selectedFinding.sourceReference}
                  </p>
                  <p className="text-xs text-[#3F3B37] leading-relaxed">
                    {selectedFinding.recommendation}
                  </p>
                </div>

                {/* Card 3: Editable Correction Workflow */}
                <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="correction-editor"
                      className="text-xs font-bold text-[#141414]"
                    >
                      Recommended Replacement / Action
                    </label>
                    <button
                      type="button"
                      onClick={() => setCorrectionDraft(selectedFinding.expectedValue)}
                      className="text-[11px] font-semibold text-[#524E4A] hover:text-[#141414]"
                    >
                      Reset Suggestion
                    </button>
                  </div>
                  <textarea
                    id="correction-editor"
                    rows={3}
                    value={correctionDraft}
                    onChange={(e) => setCorrectionDraft(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] bg-white text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateFindingCorrection(
                          activeReview.id,
                          selectedFinding.id,
                          correctionDraft,
                          true
                        )
                      }
                      className="flex-1 py-2 px-3 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors"
                    >
                      Accept &amp; Apply Fix
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateFindingCorrection(
                          activeReview.id,
                          selectedFinding.id,
                          correctionDraft,
                          false
                        )
                      }
                      className="py-2 px-3 rounded-full border border-[#E7E1DA] bg-white text-[#141414] text-xs font-semibold hover:bg-[#F3EDE8]"
                    >
                      Save Draft
                    </button>
                  </div>
                </div>

                {/* Card 4: Reviewer Comments Thread */}
                <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-bold text-[#141414]">
                    Reviewer Comments ({selectedFinding.comments.length})
                  </p>

                  {selectedFinding.comments.length > 0 && (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {selectedFinding.comments.map((cmt) => (
                        <div
                          key={cmt.id}
                          className="bg-[#FAF8F6] border border-[#EFECE7] rounded-xl p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-[#6B6560] mb-0.5">
                            <span className="font-semibold text-[#141414]">{cmt.author}</span>
                            <span>{cmt.createdAt}</span>
                          </div>
                          <p className="text-[#2B2927]">{cmt.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!commentText.trim()) return;
                      addFindingComment(activeReview.id, selectedFinding.id, commentText);
                      setCommentText("");
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      aria-label="Add governance comment"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add governance note..."
                      className="flex-1 px-3 py-2 rounded-full border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                    />
                    <button
                      type="submit"
                      aria-label="Send comment"
                      className="w-8 h-8 rounded-full bg-[#141414] text-white flex items-center justify-center shrink-0 hover:bg-[#2B2B2B]"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* Bottom Floating Dark Contextual Toolbar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 hidden md:flex items-center gap-2 bg-[#141414] px-3 py-2 rounded-full shadow-xl border border-white/10">
        {CATEGORY_TOOLBAR.slice(1).map((item) => {
          const Icon = item.icon;
          const active = categoryFilter === item.category;
          return (
            <button
              key={item.category}
              type="button"
              title={`Filter ${item.category}`}
              aria-label={`Filter ${item.category}`}
              onClick={() => setCategoryFilter(active ? "All" : item.category)}
              className={`w-9 h-9 rounded-full ${item.pastelBg} text-[#141414] flex items-center justify-center transition-transform hover:scale-105 ${
                active ? "ring-2 ring-white" : ""
              }`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        <span className="w-px h-5 bg-white/20 mx-1" />
        <button
          type="button"
          title="Add manual finding"
          aria-label="Add manual finding"
          onClick={() => setManualOpen(true)}
          className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => updateReviewStatus(activeReview.id, "Approved")}
          className="px-3.5 py-1.5 rounded-full bg-[#CDEEE0] text-[#14532D] text-xs font-bold hover:brightness-95 transition-all inline-flex items-center gap-1"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Approve
        </button>
      </div>

      {/* Add Manual Finding Modal */}
      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#141414]">Add Manual Review Finding</h2>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddManualFinding} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Finding Title
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g., Missing regional legal disclaimer"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Manual finding category"
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as FindingCategory)}
                  className="px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs bg-[#FAF8F6]"
                >
                  <option value="Brand Claims">Claims</option>
                  <option value="Terminology">Terminology</option>
                  <option value="Tone & Voice">Tone</option>
                  <option value="Visual Identity">Visual</option>
                  <option value="Legal & Usage">Legal</option>
                </select>
                <select
                  aria-label="Manual finding severity"
                  value={manualSeverity}
                  onChange={(e) => setManualSeverity(e.target.value as FindingSeverity)}
                  className="px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs bg-[#FAF8F6]"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  aria-label="Manual finding evidence status"
                  value={manualEvidence}
                  onChange={(e) => setManualEvidence(e.target.value as EvidenceStatus)}
                  className="px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs bg-[#FAF8F6]"
                >
                  <option value="conflicting">Conflicting</option>
                  <option value="unverified">Unverified</option>
                  <option value="supported">Supported</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Explanation
                </label>
                <textarea
                  rows={3}
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  placeholder="Explain what conflicts or requires verification..."
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Recommended Correction
                </label>
                <input
                  type="text"
                  value={manualRec}
                  onChange={(e) => setManualRec(e.target.value)}
                  placeholder="Suggested replacement or verification step"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setManualOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold"
                >
                  Add Finding
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReviewStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-xs text-[#6B6560]">Loading Review Studio workspace...</div>
      }
    >
      <ReviewStudioInner />
    </Suspense>
  );
}
