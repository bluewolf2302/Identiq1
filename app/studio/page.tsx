"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Eye,
  FileWarning,
  HelpCircle,
  Layers,
  MessageSquare,
  Plus,
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
import { EvidenceStatus, FindingCategory, FindingSeverity, ReviewFinding } from "@/lib/types";

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

  const [categoryFilter, setCategoryFilter] = useState<"All" | FindingCategory>("All");
  const [evidenceFilter, setEvidenceFilter] = useState<"All" | EvidenceStatus>("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string>("");
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
      const catMatch = categoryFilter === "All" || f.category === categoryFilter;
      const evMatch = evidenceFilter === "All" || f.evidenceStatus === evidenceFilter;
      const q = searchTerm.trim().toLowerCase();
      const textMatch =
        !q ||
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.sourceReference.toLowerCase().includes(q) ||
        f.affectedContent.toLowerCase().includes(q);
      return catMatch && evMatch && textMatch;
    });
  }, [activeReview, categoryFilter, evidenceFilter, searchTerm]);

  const selectedFinding = useMemo(() => {
    if (!activeReview) return null;
    return (
      activeReview.findings.find((f) => f.id === selectedFindingId) ||
      filteredFindings[0] ||
      activeReview.findings[0] ||
      null
    );
  }, [activeReview, selectedFindingId, filteredFindings]);

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
  const resolvedOrSupported = activeReview.findings.filter(
    (f) => f.resolved || f.evidenceStatus === "supported"
  ).length;
  const openOrUnverified = activeReview.findings.filter((f) => !f.resolved).length;
  const statusMeta = REVIEW_STATUS_META[activeReview.status];

  const renderHighlightedCopy = () => {
    const copy = activeReview.textContent;
    const phrase = selectedFinding?.affectedContent?.trim();
    if (!phrase || !copy.toLowerCase().includes(phrase.toLowerCase())) {
      return <p className="text-sm text-[#2B2927] leading-relaxed">{copy}</p>;
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
      <p className="text-sm text-[#2B2927] leading-relaxed">
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

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#F7F6F3] flex flex-col">
      {/* Studio Workspace Grid */}
      <div className="flex-1 max-w-[1520px] w-full mx-auto px-4 sm:px-6 py-5 pb-24">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left / Center Split Area (Reference 2 light workspace + floating tool strip) */}
          <div className="xl:col-span-8 flex gap-4 items-start">
            {/* Reference 2 Left Vertical Floating Tool Strip */}
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
              {/* Top Studio Controls + Reference 2 3-Tile KPI Counters */}
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

                {/* Reference 2 Search + 3 KPI Counter Tiles */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#6B6560] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
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

              {/* Submitted Content Preview Card */}
              <div className="bg-white border border-[#E7E1DA] rounded-[24px] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-[#EFECE7]">
                  <div>
                    <h2 className="text-base font-bold text-[#141414]">{activeReview.title}</h2>
                    <p className="text-xs text-[#6B6560] tabular-nums">
                      Submitted by {activeReview.submittedBy} · {activeReview.submittedAt} ·
                      Compliance Score: {activeReview.complianceScore}%
                    </p>
                    {activeReview.providerUsed && (
                      <p className="text-[11px] text-[#6B6560] mt-1">
                        Analyzed by {activeReview.providerUsed}
                        {activeReview.fallbackUsed ? " (fallback used)" : ""}
                        {activeReview.analysisRunId ? ` · Run ${activeReview.analysisRunId}` : ""}
                      </p>
                    )}
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
                  {activeReview.assetUrl && (
                    <div className="md:col-span-5">
                      <img
                        src={activeReview.assetUrl}
                        alt={activeReview.assetName || activeReview.title}
                        referrerPolicy="no-referrer"
                        className="w-full aspect-[4/3] object-cover rounded-2xl border border-[#E7E1DA]"
                      />
                      {activeReview.assetName && (
                        <p className="text-[11px] font-mono text-[#6B6560] mt-1.5 truncate">
                          {activeReview.assetName}
                        </p>
                      )}
                    </div>
                  )}
                  <div className={activeReview.assetUrl ? "md:col-span-7" : "md:col-span-12"}>
                    <p className="text-[11px] font-semibold text-[#6B6560] mb-1.5">
                      Submitted Copy (highlighted for selected finding)
                    </p>
                    <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4">
                      {renderHighlightedCopy()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Evidence Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
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

              {/* Findings List (Reference 2 Card Aesthetics) */}
              {filteredFindings.length === 0 ? (
                <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-8 text-center">
                  <p className="text-sm font-semibold text-[#141414]">
                    No findings match the current filter
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter("All");
                      setEvidenceFilter("All");
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
                    return (
                      <div
                        key={finding.id}
                        onClick={() => setSelectedFindingId(finding.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setSelectedFindingId(finding.id);
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

                          {/* Reference 2 Circular Checkmark / Resolve Action */}
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
                              Affected:{" "}
                              <span className="font-mono text-[#141414]">
                                &ldquo;{finding.affectedContent}&rdquo;
                              </span>
                            </span>
                            <span className="text-[#6B6560] text-[11px]">
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

          {/* Reference 2 Right-Side Evidence & Corrections Panel */}
          <aside className="xl:col-span-4 bg-white border border-[#E7E1DA] rounded-[26px] p-5 space-y-4 sticky top-20">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#141414]">Evidence & Corrections</h2>
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
                {/* Card 1: Evidence State & Detected vs Expected (Pastel Card) */}
                <div
                  className={`${EVIDENCE_STYLE[selectedFinding.evidenceStatus].cardBg} border ${
                    EVIDENCE_STYLE[selectedFinding.evidenceStatus].cardBorder
                  } rounded-2xl p-4 space-y-2.5`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#141414]">
                      {renderEvidenceIcon(selectedFinding.evidenceStatus)}
                      {EVIDENCE_STYLE[selectedFinding.evidenceStatus].label}
                    </span>
                    <span className="text-[11px] font-medium text-[#3F3B37]">
                      {selectedFinding.category}
                    </span>
                  </div>

                  <div className="text-xs space-y-1.5">
                    <div>
                      <span className="font-semibold text-[#3F3B37]">Detected: </span>
                      <span className="text-[#141414]">{selectedFinding.detectedValue}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[#3F3B37]">Expected: </span>
                      <span className="text-[#141414]">{selectedFinding.expectedValue}</span>
                    </div>
                  </div>
                </div>

                {/* Card 2: Source Guideline / Approved Fact Reference (Pastel Lavender) */}
                <div className="bg-[#E2DBFB]/70 border border-[#D3CAEE] rounded-2xl p-4 space-y-1.5">
                  <p className="text-[11px] font-bold text-[#141414]">
                    Source Guideline Reference
                  </p>
                  <p className="text-xs font-semibold text-[#2B2927]">
                    {selectedFinding.sourceReference}
                  </p>
                  <p className="text-xs text-[#3F3B37] leading-relaxed">
                    {selectedFinding.recommendation}
                  </p>
                </div>

                {/* Card 3: Editable Correction Workflow (Pastel Yellow / Mint) */}
                <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="correction-editor"
                      className="text-xs font-bold text-[#141414]"
                    >
                      Recommended Replacement Copy
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
                      Accept & Apply Fix
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

      {/* Reference 2 Signature Floating Dark Bottom Contextual Toolbar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 hidden md:flex items-center gap-2 bg-[#141414] px-3 py-2 rounded-full shadow-xl border border-white/10">
        {CATEGORY_TOOLBAR.slice(1).map((item) => {
          const Icon = item.icon;
          const active = categoryFilter === item.category;
          return (
            <button
              key={item.category}
              type="button"
              title={`Filter ${item.category}`}
              onClick={() =>
                setCategoryFilter(active ? "All" : item.category)
              }
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
                  value={manualSeverity}
                  onChange={(e) => setManualSeverity(e.target.value as FindingSeverity)}
                  className="px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs bg-[#FAF8F6]"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
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
