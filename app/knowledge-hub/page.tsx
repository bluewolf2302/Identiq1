"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Ban,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  Loader2,
  MessageSquareQuote,
  Palette,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { GuidelinePdfReviewPanel } from "@/components/GuidelinePdfReviewPanel";
import { KnowledgeEntry, KnowledgeSection } from "@/lib/types";

const SECTIONS: Array<{
  id: KnowledgeSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
}> = [
  {
    id: "guidelines",
    label: "Brand Guidelines",
    description:
      "Core positioning rules, visual layout standards, and editorial structure.",
    icon: BookOpen,
    tint: "bg-[#DDF0FA]",
  },
  {
    id: "facts",
    label: "Approved Brand Facts",
    description:
      "Verified statistics, market availability, pricing, and audited product metrics.",
    icon: FileCheck2,
    tint: "bg-[#CDEEE0]",
  },
  {
    id: "terminology",
    label: "Terminology & Wording",
    description:
      "Preferred product nomenclature and deprecated phrases to avoid.",
    icon: MessageSquareQuote,
    tint: "bg-[#E2DBFB]",
  },
  {
    id: "prohibited",
    label: "Restricted Claims",
    description:
      "Prohibited guarantees, unsubstantiated medical or security superlatives.",
    icon: Ban,
    tint: "bg-[#F6D5DA]",
  },
  {
    id: "voice",
    label: "Brand Voice & Tone",
    description:
      "Editorial warmth, precision, and cadence standards across channels.",
    icon: ShieldCheck,
    tint: "bg-[#F9DEC0]",
  },
  {
    id: "visual",
    label: "Colours & Typography",
    description:
      "Approved hex palettes (#RRGGBB), surface tokens, and font hierarchy rules.",
    icon: Palette,
    tint: "bg-[#FAF0C8]",
  },
  {
    id: "policies",
    label: "Usage Policies",
    description:
      "Co-branding, creator disclosure, and legal attribution requirements.",
    icon: CheckCircle2,
    tint: "bg-[#CDEEE0]",
  },
];

type StatusFilter = "All" | "Published" | "Draft" | "Archived";

function parseHexCodesInput(raw: string): { valid: string[]; invalid: string[] } {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const normalized = part.startsWith("#") ? part.toUpperCase() : `#${part.toUpperCase()}`;
    if (/^#[0-9A-F]{6}$/.test(normalized)) {
      if (!valid.includes(normalized)) valid.push(normalized);
    } else {
      invalid.push(part);
    }
  }
  return { valid, invalid };
}

export default function KnowledgeHubPage() {
  const {
    knowledge,
    workspaceBrands,
    selectedBrandId,
    selectedBrand,
    versionSnapshots,
    knowledgeLoading,
    knowledgeMutating,
    knowledgeError,
    selectBrand,
    createWorkspaceBrand,
    saveKnowledgeEntry,
    publishKnowledgeEntry,
    archiveKnowledgeEntry,
    refreshBrands,
    getKnowledgeRequestContext,
    notify,
  } = useIdentiq();

  const [activeView, setActiveView] = useState<"knowledge" | "guidelines">(
    "knowledge"
  );
  const [activeSection, setActiveSection] =
    useState<KnowledgeSection>("guidelines");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [sourceDocFilter, setSourceDocFilter] = useState<string>("");
  const [sourcePageFilter, setSourcePageFilter] = useState<number | null>(null);
  const [sourcePdfUrl, setSourcePdfUrl] = useState<string | null>(null);
  const [sourcePdfTitle, setSourcePdfTitle] = useState<string>("");
  const appliedDeepLinkRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || appliedDeepLinkRef.current) return;
    appliedDeepLinkRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const paramBrandId = params.get("brandId")?.trim();
    const paramDocId = params.get("sourceDocId")?.trim();
    const paramPage = params.get("page")?.trim();
    if (!paramBrandId && !paramDocId && !paramPage) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (paramBrandId && paramBrandId !== selectedBrandId) {
        void selectBrand(paramBrandId);
      }
      if (paramDocId) {
        setSourceDocFilter(paramDocId);
        setActiveView("knowledge");
      }
      if (paramPage) {
        const n = Number.parseInt(paramPage, 10);
        if (Number.isFinite(n) && n > 0) setSourcePageFilter(n);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedBrandId, selectBrand]);

  useEffect(() => {
    return () => {
      if (sourcePdfUrl) URL.revokeObjectURL(sourcePdfUrl);
    };
  }, [sourcePdfUrl]);

  const handleInspectSourcePdf = async (entry: KnowledgeEntry) => {
    if (!entry.sourceDocumentId) return;
    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const params = new URLSearchParams({ organisationId });
      const res = await fetch(
        `/api/guidelines/documents/${encodeURIComponent(entry.sourceDocumentId)}/file?${params.toString()}`,
        { headers },
      );
      if (!res.ok) {
        throw new Error("Original PDF file is not stored in this workspace for that source ID.");
      }
      const blob = await res.blob();
      if (sourcePdfUrl) URL.revokeObjectURL(sourcePdfUrl);
      setSourcePdfUrl(URL.createObjectURL(blob));
      setSourcePdfTitle(entry.sourceTitle || entry.sourceDocumentId);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Unable to open source PDF.",
        "info",
      );
    }
  };

  // Entry Add/Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formSection, setFormSection] =
    useState<KnowledgeSection>("guidelines");
  const [formPreferred, setFormPreferred] = useState("");
  const [formAvoid, setFormAvoid] = useState("");
  const [formHexInput, setFormHexInput] = useState("");
  const [formFontFamily, setFormFontFamily] = useState("");
  const [formSourceDocId, setFormSourceDocId] = useState("");
  const [formSourceTitle, setFormSourceTitle] = useState("");
  const [formSectionRef, setFormSectionRef] = useState("");
  const [formPageNumber, setFormPageNumber] = useState("");
  const [formSeverity, setFormSeverity] = useState<"high" | "medium" | "low">(
    "medium"
  );
  const [formError, setFormError] = useState("");

  // Create Brand Modal
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandNameInput, setBrandNameInput] = useState("");
  const [brandDescInput, setBrandDescInput] = useState("");
  const [brandWebsiteInput, setBrandWebsiteInput] = useState("");
  const [brandVoiceInput, setBrandVoiceInput] = useState("");
  const [brandFormError, setBrandFormError] = useState("");

  const currentSectionMeta = SECTIONS.find((s) => s.id === activeSection)!;

  const filteredEntries = useMemo(() => {
    return knowledge.filter((entry) => {
      if (sourceDocFilter) {
        const matchesDoc = entry.sourceDocumentId === sourceDocFilter;
        const matchesPage =
          sourcePageFilter === null || entry.pageNumber === sourcePageFilter;
        if (!matchesDoc || !matchesPage) return false;
      } else if (entry.section !== activeSection) {
        return false;
      }
      const pubStatus =
        entry.publicationStatus ||
        (entry.status === "Approved"
          ? "published"
          : entry.status === "Archived"
          ? "archived"
          : "draft");
      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Published" && pubStatus === "published") ||
        (statusFilter === "Draft" && pubStatus === "draft") ||
        (statusFilter === "Archived" && pubStatus === "archived");

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        entry.title.toLowerCase().includes(q) ||
        entry.content.toLowerCase().includes(q) ||
        (entry.preferredTerm || "").toLowerCase().includes(q) ||
        (entry.avoidTerm || "").toLowerCase().includes(q) ||
        (entry.sourceTitle || "").toLowerCase().includes(q) ||
        (entry.sourceDocumentId || "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [knowledge, activeSection, statusFilter, searchQuery, sourceDocFilter, sourcePageFilter]);

  const openCreateModal = () => {
    setEditingEntry(null);
    setFormSection(activeSection);
    setFormTitle("");
    setFormContent("");
    setFormPreferred("");
    setFormAvoid("");
    setFormHexInput("");
    setFormFontFamily("");
    setFormSourceDocId("");
    setFormSourceTitle(
      selectedBrand ? `${selectedBrand.brandName} Brand Guidelines` : ""
    );
    setFormSectionRef("");
    setFormPageNumber("");
    setFormSeverity("medium");
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setFormSection(entry.section);
    setFormTitle(entry.title);
    setFormContent(entry.content);
    setFormPreferred(entry.preferredTerm || "");
    setFormAvoid(entry.avoidTerm || "");
    setFormHexInput(entry.hexCodes ? entry.hexCodes.join(", ") : "");
    setFormFontFamily(entry.fontFamily || "");
    setFormSourceDocId(entry.sourceDocumentId || "");
    setFormSourceTitle(entry.sourceTitle || "");
    setFormSectionRef(entry.sectionRef || "");
    setFormPageNumber(entry.pageNumber ? String(entry.pageNumber) : "");
    setFormSeverity(entry.severity || "medium");
    setFormError("");
    setModalOpen(true);
  };

  const handleSaveEntry = async (publishImmediately: boolean) => {
    if (knowledgeMutating) return;
    if (!selectedBrandId) {
      setFormError("Please select or create a brand first.");
      return;
    }
    if (formTitle.trim().length < 2 || formContent.trim().length < 2) {
      setFormError(
        "Please enter both a rule title and guidance description (at least 2 characters)."
      );
      return;
    }

    const parsedHex = parseHexCodesInput(formHexInput);
    if (parsedHex.invalid.length > 0) {
      setFormError(
        `Invalid hex code(s): ${parsedHex.invalid.join(", ")}. Expected #RRGGBB format (e.g. #DC2626).`
      );
      return;
    }

    let parsedPage: number | undefined;
    if (formPageNumber.trim()) {
      const n = Number.parseInt(formPageNumber.trim(), 10);
      if (!Number.isFinite(n) || n <= 0) {
        setFormError("Page number must be a positive whole number.");
        return;
      }
      parsedPage = n;
    }

    setFormError("");
    try {
      await saveKnowledgeEntry({
        id: editingEntry?.id,
        brandId: selectedBrandId,
        section: formSection,
        title: formTitle.trim(),
        content: formContent.trim(),
        preferredTerm: formPreferred.trim() || undefined,
        avoidTerm: formAvoid.trim() || undefined,
        hexCodes: parsedHex.valid.length > 0 ? parsedHex.valid : undefined,
        fontFamily: formFontFamily.trim() || undefined,
        severity: formSeverity,
        sourceDocumentId: formSourceDocId.trim() || undefined,
        sourceTitle: formSourceTitle.trim() || undefined,
        sectionRef: formSectionRef.trim() || undefined,
        pageNumber: parsedPage,
        publishImmediately,
      });
      setActiveSection(formSection);
      setModalOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save knowledge entry."
      );
    }
  };

  const handleCreateBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (knowledgeMutating) return;
    if (brandNameInput.trim().length < 2) {
      setBrandFormError("Brand name must be at least 2 characters.");
      return;
    }
    setBrandFormError("");
    try {
      await createWorkspaceBrand({
        brandName: brandNameInput.trim(),
        description: brandDescInput.trim() || undefined,
        website: brandWebsiteInput.trim() || undefined,
        voiceAndToneSummary: brandVoiceInput.trim() || undefined,
      });
      setBrandNameInput("");
      setBrandDescInput("");
      setBrandWebsiteInput("");
      setBrandVoiceInput("");
      setBrandModalOpen(false);
    } catch (err) {
      setBrandFormError(
        err instanceof Error ? err.message : "Unable to create brand."
      );
    }
  };

  const publishedCount = knowledge.filter(
    (k) => (k.publicationStatus || (k.status === "Approved" ? "published" : "draft")) === "published"
  ).length;
  const draftCount = knowledge.filter(
    (k) => (k.publicationStatus || (k.status === "Pending Review" ? "draft" : "published")) === "draft"
  ).length;
  const archivedCount = knowledge.filter(
    (k) => (k.publicationStatus || (k.status === "Archived" ? "archived" : "draft")) === "archived"
  ).length;

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1 tabular-nums">
            {publishedCount} Published Rules · {draftCount} Drafts ·{" "}
            {archivedCount} Archived
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Brand Knowledge Hub
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Brand Selector */}
          <div className="flex items-center gap-2 bg-white border border-[#E7E1DA] rounded-full px-3.5 py-1.5">
            <Building2 className="w-4 h-4 text-[#6B6560] shrink-0" />
            <label htmlFor="kh-brand-select" className="sr-only">
              Active Brand
            </label>
            <select
              id="kh-brand-select"
              value={selectedBrandId || ""}
              onChange={(e) => void selectBrand(e.target.value)}
              disabled={knowledgeLoading || workspaceBrands.length === 0}
              className="bg-transparent text-xs font-semibold text-[#141414] focus:outline-none pr-1"
            >
              {workspaceBrands.length === 0 ? (
                <option value="">No brands configured</option>
              ) : (
                workspaceBrands.map((b) => (
                  <option key={b.brandId} value={b.brandId}>
                    {b.brandName}
                    {b.isSample ? " [Sample]" : ""} (
                    {b.publishedEntryCount} published)
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setBrandFormError("");
              setBrandModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] text-xs font-semibold text-[#141414] transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Brand
          </button>

          {activeView === "knowledge" && (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!selectedBrandId}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] disabled:opacity-50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Knowledge Entry
            </button>
          )}
        </div>
      </div>

      {/* Selected Brand Summary Strip */}
      {selectedBrand && (
        <div className="bg-[#F3EDE8] border border-[#E7E1DA] rounded-[22px] px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[#141414]">
                {selectedBrand.brandName}
              </span>
              {selectedBrand.isSample && (
                <span className="px-2.5 py-0.5 rounded-full bg-[#E2DBFB] text-[#3B2667] text-[11px] font-semibold inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Demo Sample Fixture
                </span>
              )}
              {selectedBrand.latestPublishedVersion ? (
                <span className="px-2.5 py-0.5 rounded-full bg-[#CDEEE0] text-[#14532D] text-[11px] font-semibold">
                  Active Version: {selectedBrand.latestPublishedVersion}
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-[#FAF0C8] text-[#664D03] text-[11px] font-semibold">
                  No Published Version Yet
                </span>
              )}
            </div>
            <p className="text-xs text-[#524E4A] truncate">
              {selectedBrand.description ||
                "Only Published rules from this brand are used during content & visual analysis. Drafts and archived rules stay isolated."}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setVersionsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] text-xs font-semibold text-[#141414] transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              Version History ({versionSnapshots.length})
            </button>
          </div>
        </div>
      )}

      {/* Version History Drawer/Strip */}
      {versionsOpen && (
        <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#141414]">
              Published Knowledge Versions · {selectedBrand?.brandName}
            </h2>
            <button
              type="button"
              onClick={() => setVersionsOpen(false)}
              aria-label="Close version history"
              className="p-1 rounded-lg hover:bg-[#FAF8F6]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {versionSnapshots.length === 0 ? (
            <p className="text-xs text-[#6B6560]">
              No published snapshots recorded yet. Publish any draft entry to
              create version v1.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {versionSnapshots.map((snap) => (
                <div
                  key={snap.snapshotId}
                  className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-3.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#141414]">
                      Version {snap.versionId}
                    </span>
                    <span className="text-[11px] font-mono text-[#6B6560]">
                      {snap.entryCount} published rules
                    </span>
                  </div>
                  <p className="text-[#524E4A]">
                    Published by {snap.publishedBy}
                  </p>
                  <p className="text-[11px] text-[#6B6560] tabular-nums">
                    {snap.publishedAt.slice(0, 16).replace("T", " ")}
                  </p>
                  {snap.note && (
                    <p className="text-[11px] text-[#3F3B37] italic pt-0.5">
                      {snap.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {knowledgeError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F6D5DA]/70 border border-[#EBC3CA] text-[#7F1D1D] px-4 py-3 rounded-2xl text-xs font-medium"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{knowledgeError}</span>
          </div>
          <button
            type="button"
            onClick={() => void refreshBrands()}
            className="px-3 py-1.5 rounded-full bg-[#141414] text-white text-xs font-semibold shrink-0"
          >
            Retry Sync
          </button>
        </div>
      )}

      <div
        aria-label="Knowledge Hub sections"
        className="inline-flex items-center gap-1.5 rounded-2xl border border-[#E7E1DA] bg-[#F3EDE8] p-1.5"
      >
        <button
          type="button"
          aria-pressed={activeView === "knowledge"}
          onClick={() => setActiveView("knowledge")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeView === "knowledge"
              ? "bg-white text-[#141414] shadow-xs"
              : "text-[#524E4A] hover:bg-white/60"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Knowledge entries
        </button>
        <button
          type="button"
          aria-pressed={activeView === "guidelines"}
          onClick={() => setActiveView("guidelines")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
            activeView === "guidelines"
              ? "bg-white text-[#141414] shadow-xs"
              : "text-[#524E4A] hover:bg-white/60"
          }`}
        >
          <FileCheck2 className="h-4 w-4" />
          Guideline PDFs
        </button>
      </div>

      {activeView === "guidelines" ? (
        <GuidelinePdfReviewPanel />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Section Navigation */}
          <div className="lg:col-span-4 xl:col-span-3 bg-[#F3EDE8] border border-[#E7E1DA] rounded-[24px] p-3 space-y-1">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const count = knowledge.filter((k) => k.section === sec.id).length;
              const active = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-2xl text-left text-xs font-medium transition-colors ${
                    active
                      ? "bg-white text-[#141414] font-semibold shadow-xs"
                      : "text-[#524E4A] hover:bg-white/60 hover:text-[#141414]"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
                        active ? sec.tint : "bg-white"
                      } text-[#141414]`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate">{sec.label}</span>
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-[#6B6560]">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Main Knowledge Entries Area */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
            {/* Active Section Banner + Filters */}
            <div
              className={`${currentSectionMeta.tint} border border-black/10 rounded-[24px] p-5`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[#141414]">
                    {currentSectionMeta.label}
                  </h2>
                  <p className="text-xs text-[#3F3B37] mt-1">
                    {currentSectionMeta.description}
                  </p>
                </div>
                {knowledgeLoading && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#3F3B37]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Syncing...
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-4 border-t border-black/10">
                <div className="flex flex-wrap items-center gap-1 bg-white/75 p-1 rounded-xl w-fit">
                  {(["All", "Published", "Draft", "Archived"] as const).map(
                    (status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setStatusFilter(status)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          statusFilter === status
                            ? "bg-[#141414] text-white"
                            : "text-[#524E4A] hover:text-[#141414]"
                        }`}
                      >
                        {status}
                      </button>
                    )
                  )}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-[#6B6560] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search rules, terms, sources..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-black/10 text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                  />
                </div>
              </div>
            </div>

            {sourceDocFilter && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D3CAEE] bg-[#E2DBFB]/55 px-4 py-3 text-xs text-[#141414]">
                <span>
                  Inspecting entries linked to source{" "}
                  <strong className="font-mono">{sourceDocFilter}</strong>
                  {sourcePageFilter ? ` · page ${sourcePageFilter}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSourceDocFilter("");
                    setSourcePageFilter(null);
                  }}
                  className="rounded-full bg-[#141414] px-3 py-1 text-[11px] font-semibold text-white"
                >
                  Clear Source Filter
                </button>
              </div>
            )}

            {/* Entries List */}
            {filteredEntries.length === 0 ? (
              <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-8 text-center">
                <p className="text-sm font-semibold text-[#141414]">
                  No entries in {currentSectionMeta.label} match this filter
                </p>
                <p className="text-xs text-[#6B6560] mt-1 mb-4">
                  Add a new rule or switch the publication status filter.
                </p>
                <button
                  type="button"
                  onClick={openCreateModal}
                  disabled={!selectedBrandId}
                  className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold disabled:opacity-50"
                >
                  Add Entry
                </button>
              </div>
            ) : (
              <div className="space-y-3.5">
                {filteredEntries.map((entry) => {
                  const pubStatus =
                    entry.publicationStatus ||
                    (entry.status === "Approved"
                      ? "published"
                      : entry.status === "Archived"
                      ? "archived"
                      : "draft");
                  const isPublished = pubStatus === "published";
                  const isArchived = pubStatus === "archived";

                  return (
                    <div
                      key={entry.id}
                      className={`bg-white border rounded-[22px] p-5 flex flex-col gap-3 ${
                        sourceDocFilter && entry.sourceDocumentId === sourceDocFilter
                          ? "border-[#141414] ring-1 ring-[#141414]/20"
                          : "border-[#E7E1DA]"
                      } ${isArchived ? "opacity-75" : ""}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold px-2.5 py-0.5 rounded-full ${
                                isPublished
                                  ? "bg-[#CDEEE0] text-[#14532D]"
                                  : isArchived
                                  ? "bg-[#F3EDE8] text-[#524E4A]"
                                  : "bg-[#FAF0C8] text-[#664D03]"
                              }`}
                            >
                              {isPublished ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : isArchived ? (
                                <Archive className="w-3.5 h-3.5" />
                              ) : (
                                <Clock className="w-3.5 h-3.5" />
                              )}
                              {isPublished
                                ? "Published"
                                : isArchived
                                ? "Archived"
                                : "Draft"}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                entry.entryOrigin === "guideline_pdf"
                                  ? "bg-[#E2DBFB] text-[#3B2667]"
                                  : "bg-[#FAF8F6] border border-[#E7E1DA] text-[#524E4A]"
                              }`}
                            >
                              <FileText className="w-3 h-3" />
                              {entry.entryOrigin === "guideline_pdf"
                                ? "From PDF"
                                : "Manual"}
                            </span>
                            {entry.versionId && (
                              <span className="px-2 py-0.5 rounded-md bg-[#FAF8F6] border border-[#E7E1DA] font-mono text-[11px] text-[#3F3B37]">
                                {entry.versionId}
                              </span>
                            )}
                            <span className="text-[#6B6560]">{entry.owner}</span>
                            <span className="text-[#8E8780]">·</span>
                            <span className="text-[#6B6560] tabular-nums">
                              Updated {entry.updatedAt}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-[#141414]">
                            {entry.title}
                          </h3>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isPublished && (
                            <button
                              type="button"
                              disabled={knowledgeMutating}
                              onClick={() => void publishKnowledgeEntry(entry.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#141414] text-white text-xs font-medium hover:bg-[#2B2B2B] disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              <UploadCloud className="w-3.5 h-3.5" />
                              Publish
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={knowledgeMutating}
                            onClick={() => openEditModal(entry)}
                            aria-label={`Edit ${entry.title}`}
                            className="p-2 rounded-lg border border-[#E7E1DA] text-[#3F3B37] hover:bg-[#FAF8F6] disabled:opacity-50 transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {!isArchived && (
                            <button
                              type="button"
                              disabled={knowledgeMutating}
                              onClick={() =>
                                void archiveKnowledgeEntry(entry.id)
                              }
                              aria-label={`Archive ${entry.title}`}
                              title="Archive rule (removes from active governance)"
                              className="p-2 rounded-lg border border-[#E7E1DA] text-[#991B1B] hover:bg-[#F6D5DA]/40 disabled:opacity-50 transition-colors"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-sm text-[#3F3B37] leading-relaxed">
                        {entry.content}
                      </p>

                      {entry.extractedText &&
                        entry.extractedText.trim() !== entry.content.trim() && (
                          <div className="rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] px-3.5 py-2.5 text-xs">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B6560]">
                              Original PDF Excerpt (Preserved Unchanged)
                            </p>
                            <p className="mt-1 text-[#524E4A] italic">
                              &ldquo;{entry.extractedText}&rdquo;
                            </p>
                          </div>
                        )}

                      {entry.structuredFacts && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {entry.structuredFacts.productName && (
                            <span className="rounded-lg bg-[#FAF8F6] border border-[#E7E1DA] px-2.5 py-1 text-[#3F3B37]">
                              Product: <strong>{entry.structuredFacts.productName}</strong>
                            </span>
                          )}
                          {entry.structuredFacts.price && (
                            <span className="rounded-lg bg-[#CDEEE0]/50 border border-[#BAE0D0] px-2.5 py-1 font-semibold text-[#14532D]">
                              Price: {entry.structuredFacts.price}
                            </span>
                          )}
                          {(entry.structuredFacts.validFrom ||
                            entry.structuredFacts.validUntil) && (
                            <span className="rounded-lg bg-[#DDF0FA]/60 border border-[#CBE2EF] px-2.5 py-1 text-[#0C4A6E]">
                              Window:{" "}
                              {[
                                entry.structuredFacts.validFrom,
                                entry.structuredFacts.validUntil,
                              ]
                                .filter(Boolean)
                                .join(" – ")}
                            </span>
                          )}
                          {entry.structuredFacts.isExpiredPromo && (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-[#F6D5DA] border border-[#EBC3CA] px-2.5 py-1 font-semibold text-[#7F1D1D]">
                              <AlertTriangle className="w-3 h-3" />
                              Expired Promo Date
                            </span>
                          )}
                        </div>
                      )}

                      {(entry.preferredTerm || entry.avoidTerm) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          {entry.preferredTerm && (
                            <div className="bg-[#CDEEE0]/45 border border-[#BAE0D0] rounded-xl px-3.5 py-2.5">
                              <p className="text-[11px] font-semibold text-[#14532D]">
                                Preferred Wording
                              </p>
                              <p className="text-xs font-medium text-[#141414] mt-0.5">
                                {entry.preferredTerm}
                              </p>
                            </div>
                          )}
                          {entry.avoidTerm && (
                            <div className="bg-[#F6D5DA]/45 border border-[#EBC3CA] rounded-xl px-3.5 py-2.5">
                              <p className="text-[11px] font-semibold text-[#7F1D1D]">
                                Avoid Using
                              </p>
                              <p className="text-xs font-medium text-[#141414] mt-0.5">
                                {entry.avoidTerm}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {((entry.hexCodes && entry.hexCodes.length > 0) ||
                        entry.fontFamily) && (
                        <div className="flex flex-wrap items-center gap-3 pt-1">
                          {entry.hexCodes?.map((hex) => (
                            <div
                              key={hex}
                              className="flex items-center gap-2 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-2.5 py-1.5"
                            >
                              <span
                                className="w-4 h-4 rounded-md border border-black/15"
                                style={{ backgroundColor: hex }}
                              />
                              <span className="text-xs font-mono text-[#141414]">
                                {hex}
                              </span>
                            </div>
                          ))}
                          {entry.fontFamily && (
                            <span className="text-xs text-[#524E4A] font-medium bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl px-2.5 py-1.5">
                              Typeface: {entry.fontFamily}
                            </span>
                          )}
                        </div>
                      )}

                      {(entry.sourceTitle || entry.sourceDocumentId) && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F3EDE8] text-[11px] text-[#6B6560]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#3F3B37]">
                              Source:
                            </span>
                            <span>{entry.sourceTitle}</span>
                            {entry.sourceDocumentId && (
                              <span className="font-mono text-[#524E4A]">
                                ({entry.sourceDocumentId})
                              </span>
                            )}
                            {entry.sourceDocumentVersion && (
                              <span>· {entry.sourceDocumentVersion}</span>
                            )}
                            {entry.sectionRef && <span>· {entry.sectionRef}</span>}
                            {entry.pageNumber && (
                              <span>· p.{entry.pageNumber}</span>
                            )}
                          </div>
                          {entry.entryOrigin === "guideline_pdf" &&
                            entry.sourceDocumentId && (
                              <button
                                type="button"
                                onClick={() => void handleInspectSourcePdf(entry)}
                                className="inline-flex items-center gap-1 font-semibold text-[#141414] hover:underline"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Open Source PDF
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Knowledge Entry Modal */}
      {activeView === "knowledge" && modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-xl w-full p-6 shadow-xl my-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-[#141414]">
                  {editingEntry
                    ? "Edit Knowledge Entry"
                    : "Add Brand Knowledge Entry"}
                </h2>
                {selectedBrand && (
                  <p className="text-xs text-[#6B6560]">
                    Brand: {selectedBrand.brandName}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveEntry(false);
              }}
              className="space-y-4"
            >
              {formError && (
                <p
                  role="alert"
                  className="text-xs text-[#991B1B] bg-[#F6D5DA]/60 px-3 py-2 rounded-xl"
                >
                  {formError}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Section
                  </label>
                  <select
                    value={formSection}
                    onChange={(e) =>
                      setFormSection(e.target.value as KnowledgeSection)
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414]"
                  >
                    {SECTIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Severity
                  </label>
                  <select
                    value={formSeverity}
                    onChange={(e) =>
                      setFormSeverity(
                        e.target.value as "high" | "medium" | "low"
                      )
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414]"
                  >
                    <option value="high">High (Must Flag)</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Rule or Fact Title
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Official Launch Price or Prohibited Medical Claim"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              {editingEntry?.extractedText && (
                <div className="rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] px-3.5 py-2.5 text-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B6560]">
                    Original PDF Excerpt (Locked)
                  </p>
                  <p className="mt-1 text-[#524E4A] whitespace-pre-wrap">
                    {editingEntry.extractedText}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Detailed Guidance / Verified Fact
                </label>
                <textarea
                  rows={3}
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Describe the approved rule, exact product price/spec, or prohibited claim boundary..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Preferred Wording (Optional)
                  </label>
                  <input
                    type="text"
                    value={formPreferred}
                    onChange={(e) => setFormPreferred(e.target.value)}
                    placeholder="e.g., Crimson Studio"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Avoid / Prohibited Wording (Optional)
                  </label>
                  <input
                    type="text"
                    value={formAvoid}
                    onChange={(e) => setFormAvoid(e.target.value)}
                    placeholder="e.g., miracle cure, instant fix"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                  />
                </div>
              </div>

              {(formSection === "visual" ||
                formHexInput.trim() ||
                formFontFamily.trim()) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                      Approved Hex Colours (#RRGGBB)
                    </label>
                    <input
                      type="text"
                      value={formHexInput}
                      onChange={(e) => setFormHexInput(e.target.value)}
                      placeholder="e.g., #DC2626, #141414"
                      className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                      Approved Typeface (Optional)
                    </label>
                    <input
                      type="text"
                      value={formFontFamily}
                      onChange={(e) => setFormFontFamily(e.target.value)}
                      placeholder="e.g., Plus Jakarta Sans"
                      className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-[#F3EDE8]">
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Source Title
                  </label>
                  <input
                    type="text"
                    value={formSourceTitle}
                    onChange={(e) => setFormSourceTitle(e.target.value)}
                    placeholder="e.g., Brand Bible v2"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                    Source Doc ID
                  </label>
                  <input
                    type="text"
                    value={formSourceDocId}
                    onChange={(e) => setFormSourceDocId(e.target.value)}
                    placeholder="e.g., SRC-CRIMSON-01"
                    className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414] font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                      Section Ref
                    </label>
                    <input
                      type="text"
                      value={formSectionRef}
                      onChange={(e) => setFormSectionRef(e.target.value)}
                      placeholder="Sec 2.1"
                      className="w-full px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                      Page #
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={formPageNumber}
                      onChange={(e) => setFormPageNumber(e.target.value)}
                      placeholder="4"
                      className="w-full px-2.5 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={knowledgeMutating}
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#3F3B37] hover:bg-[#FAF8F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={knowledgeMutating}
                  className="px-4 py-2 rounded-full border border-[#141414] text-[#141414] text-xs font-semibold hover:bg-[#FAF8F6] disabled:opacity-50"
                >
                  {knowledgeMutating ? "Saving..." : "Save as Draft"}
                </button>
                <button
                  type="button"
                  disabled={knowledgeMutating}
                  onClick={() => void handleSaveEntry(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] disabled:opacity-50"
                >
                  {knowledgeMutating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  Save &amp; Publish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Brand Modal */}
      {brandModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#141414]">
                Create Brand Profile
              </h2>
              <button
                type="button"
                onClick={() => setBrandModalOpen(false)}
                aria-label="Close create brand modal"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBrand} className="space-y-4">
              {brandFormError && (
                <p
                  role="alert"
                  className="text-xs text-[#991B1B] bg-[#F6D5DA]/60 px-3 py-2 rounded-xl"
                >
                  {brandFormError}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={brandNameInput}
                  onChange={(e) => setBrandNameInput(e.target.value)}
                  placeholder="e.g., Crimson Studio or Emerald Bio"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Brand Positioning Summary (Optional)
                </label>
                <textarea
                  rows={2}
                  value={brandDescInput}
                  onChange={(e) => setBrandDescInput(e.target.value)}
                  placeholder="Core positioning and governance scope..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Voice &amp; Tone Summary (Optional)
                </label>
                <input
                  type="text"
                  value={brandVoiceInput}
                  onChange={(e) => setBrandVoiceInput(e.target.value)}
                  placeholder="e.g., Precise, clinical, empathetic"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3F3B37] mb-1">
                  Website (Optional)
                </label>
                <input
                  type="text"
                  value={brandWebsiteInput}
                  onChange={(e) => setBrandWebsiteInput(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={knowledgeMutating}
                  onClick={() => setBrandModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#3F3B37]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={knowledgeMutating}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] disabled:opacity-50"
                >
                  {knowledgeMutating && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Create Brand
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Source PDF Preview Modal */}
      {sourcePdfUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[24px] max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E7E1DA] bg-[#FAF8F6]">
              <p className="text-sm font-bold text-[#141414] truncate">
                {sourcePdfTitle}
              </p>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(sourcePdfUrl);
                  setSourcePdfUrl(null);
                }}
                aria-label="Close source PDF modal"
                className="p-1.5 rounded-lg hover:bg-[#EFECE7]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe
              src={sourcePdfUrl}
              title={sourcePdfTitle}
              className="w-full flex-1 bg-[#F3EDE8]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
