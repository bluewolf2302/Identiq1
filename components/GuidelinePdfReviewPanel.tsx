"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSearch,
  FileText,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import type {
  ConflictResolution,
  GuidelineDocumentSession,
  KnowledgeProposal,
} from "@/lib/guidelines/document-repository";
import type { KnowledgeSection } from "@/lib/types";

const CATEGORY_OPTIONS: Array<{ value: KnowledgeSection; label: string }> = [
  { value: "guidelines", label: "Brand Guidelines" },
  { value: "facts", label: "Approved Brand Facts" },
  { value: "terminology", label: "Terminology & Wording" },
  { value: "prohibited", label: "Restricted Claims" },
  { value: "voice", label: "Brand Voice & Tone" },
  { value: "visual", label: "Colours & Typography" },
  { value: "policies", label: "Usage Policies" },
];

type ProposalDraftEdits = {
  title: string;
  content: string;
  category: KnowledgeSection;
  sectionRef: string;
  preferredTerm: string;
  avoidTerm: string;
  hexInput: string;
  fontFamily: string;
  productName: string;
  price: string;
  validFrom: string;
  validUntil: string;
  conflictResolution: ConflictResolution;
};

type SelectedSourcePassage = {
  pageNumber: number;
  text: string;
};

function createDraftEditsFromProposal(p: KnowledgeProposal): ProposalDraftEdits {
  return {
    title: p.title,
    content: p.content,
    category: p.category,
    sectionRef: p.sectionRef || "",
    preferredTerm: p.preferredTerm || "",
    avoidTerm: p.avoidTerm || "",
    hexInput: p.hexCodes?.join(", ") || "",
    fontFamily: p.fontFamily || "",
    productName: p.structuredFacts?.productName || "",
    price: p.structuredFacts?.price || "",
    validFrom: p.structuredFacts?.validFrom || "",
    validUntil: p.structuredFacts?.validUntil || "",
    conflictResolution: p.conflictResolution || "unresolved",
  };
}

function parseHexCodes(raw: string): string[] | undefined {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t.toUpperCase() : `#${t.toUpperCase()}`))
    .filter((t) => /^#[0-9A-F]{6}$/.test(t));
  return tokens.length > 0 ? [...new Set(tokens)] : undefined;
}

function defaultTitleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Brand Guideline PDF"
  );
}

export function GuidelinePdfReviewPanel() {
  const {
    selectedBrandId,
    selectedBrand,
    persistenceMode,
    getKnowledgeRequestContext,
    reloadSelectedBrandKnowledge,
    notify,
  } = useIdentiq();

  const [sessions, setSessions] = useState<GuidelineDocumentSession[]>([]);
  const [activeDocId, setActiveDocId] = useState<string>("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docTitleInput, setDocTitleInput] = useState("");
  const [docVersionInput, setDocVersionInput] = useState("doc-v1");
  const [enableOcr, setEnableOcr] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<{
    existingDocumentId: string;
    existingTitle: string;
    existingVersion: string;
  } | null>(null);

  // Source PDF preview modal (via private authenticated /file route)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState<string>("");
  const [loadingPdfPreview, setLoadingPdfPreview] = useState(false);

  // Proposal drafts & per-card errors/locks
  const [draftsById, setDraftsById] = useState<Record<string, ProposalDraftEdits>>(
    {},
  );
  const [busyProposalId, setBusyProposalId] = useState<string>("");
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>(
    {},
  );
  const [proposalFilter, setProposalFilter] = useState<
    "all" | "needs_review" | "conflicts" | "published"
  >("all");
  const [discardingDoc, setDiscardingDoc] = useState(false);

  // Manual passage selection from extracted page viewer
  const [selectedPassage, setSelectedPassage] =
    useState<SelectedSourcePassage | null>(null);
  const [manualSectionRef, setManualSectionRef] = useState("");
  const [manualCategory, setManualCategory] =
    useState<KnowledgeSection>("guidelines");
  const [addingManual, setAddingManual] = useState(false);
  const pageTextRefs = useRef(new Map<number, HTMLPreElement>());
  const sessionsReqGenRef = useRef(0);
  const sessionsAbortRef = useRef<AbortController | null>(null);

  const syncDraftsForSessions = useCallback(
    (loadedSessions: GuidelineDocumentSession[]) => {
      setDraftsById((prev) => {
        const next: Record<string, ProposalDraftEdits> = { ...prev };
        for (const s of loadedSessions) {
          for (const p of s.proposals) {
            if (!next[p.proposalId]) {
              next[p.proposalId] = createDraftEditsFromProposal(p);
            }
          }
        }
        return next;
      });
    },
    [],
  );

  const loadSessions = useCallback(async () => {
    const reqGen = ++sessionsReqGenRef.current;
    sessionsAbortRef.current?.abort();

    if (!selectedBrandId) {
      setSessions([]);
      setActiveDocId("");
      setLoadingSessions(false);
      setLoadError("");
      return;
    }

    const controller = new AbortController();
    sessionsAbortRef.current = controller;
    const { organisationId, headers } = getKnowledgeRequestContext();
    setLoadingSessions(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({
        brandId: selectedBrandId,
        organisationId,
      });
      const res = await fetch(`/api/guidelines/documents?${params.toString()}`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessions?: GuidelineDocumentSession[];
      };
      if (sessionsReqGenRef.current !== reqGen) return;
      if (!res.ok) {
        throw new Error(body.error || "Unable to load saved guideline sessions.");
      }
      const list = Array.isArray(body.sessions) ? body.sessions : [];
      setSessions(list);
      syncDraftsForSessions(list);
      setActiveDocId((current) =>
        current && list.some((s) => s.documentId === current)
          ? current
          : list[0]?.documentId || "",
      );
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        sessionsReqGenRef.current !== reqGen
      ) {
        return;
      }
      setLoadError(
        err instanceof Error
          ? err.message
          : "Unable to load saved guideline sessions.",
      );
    } finally {
      if (sessionsReqGenRef.current === reqGen) {
        setLoadingSessions(false);
      }
    }
  }, [selectedBrandId, getKnowledgeRequestContext, syncDraftsForSessions]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSessions([]);
      setActiveDocId("");
      setSelectedPassage(null);
      setUploadError("");
      setDuplicateInfo(null);
      void loadSessions();
    });
    return () => {
      active = false;
      sessionsAbortRef.current?.abort();
    };
  }, [loadSessions]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.documentId === activeDocId) ?? null,
    [sessions, activeDocId],
  );

  const counts = useMemo(() => {
    const proposals = activeSession?.proposals ?? [];
    return {
      total: proposals.filter((p) => p.status !== "discarded").length,
      pending: proposals.filter(
        (p) => p.status === "pending_review" || p.status === "draft_saved",
      ).length,
      published: proposals.filter((p) => p.status === "published").length,
      conflicts: proposals.filter(
        (p) =>
          p.status !== "discarded" &&
          p.status !== "published" &&
          (p.conflictStatus === "conflict" ||
            p.conflictStatus === "possible_conflict"),
      ).length,
      needsReview: proposals.filter(
        (p) =>
          p.status !== "discarded" &&
          p.status !== "published" &&
          (p.classificationUncertain || p.requiresHumanReview),
      ).length,
    };
  }, [activeSession]);

  const visibleProposals = useMemo(() => {
    if (!activeSession) return [];
    const nonDiscarded = activeSession.proposals.filter(
      (p) => p.status !== "discarded",
    );
    switch (proposalFilter) {
      case "needs_review":
        return nonDiscarded.filter(
          (p) =>
            p.status !== "published" &&
            (p.classificationUncertain || p.requiresHumanReview),
        );
      case "conflicts":
        return nonDiscarded.filter(
          (p) =>
            p.status !== "published" &&
            (p.conflictStatus === "conflict" ||
              p.conflictStatus === "possible_conflict"),
        );
      case "published":
        return nonDiscarded.filter((p) => p.status === "published");
      default:
        return nonDiscarded;
    }
  }, [activeSession, proposalFilter]);

  const updateLocalSession = (updatedSession: GuidelineDocumentSession) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.documentId === updatedSession.documentId);
      return exists
        ? prev.map((s) =>
            s.documentId === updatedSession.documentId ? updatedSession : s,
          )
        : [updatedSession, ...prev];
    });
    for (const p of updatedSession.proposals) {
      setDraftsById((prev) => ({
        ...prev,
        [p.proposalId]: createDraftEditsFromProposal(p),
      }));
    }
  };

  const submitPdfUpload = async (options?: { allowDuplicate?: boolean }) => {
    if (!selectedBrandId) {
      setUploadError("Please select or create a brand before uploading a guideline PDF.");
      return;
    }
    if (!selectedFile) {
      setUploadError("Choose a guideline PDF file to upload.");
      return;
    }

    setUploadError("");
    setDuplicateInfo(null);
    setUploading(true);
    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const formData = new FormData();
      formData.set("file", selectedFile);
      formData.set("brandId", selectedBrandId);
      formData.set("organisationId", organisationId);
      formData.set(
        "title",
        docTitleInput.trim() || defaultTitleFromFileName(selectedFile.name),
      );
      formData.set(
        "sourceDocumentVersion",
        docVersionInput.trim() || "doc-v1",
      );
      formData.set("enableOcr", enableOcr ? "true" : "false");
      if (options?.allowDuplicate) {
        formData.set("allowDuplicate", "true");
      }

      const res = await fetch("/api/guidelines/documents", {
        method: "POST",
        headers,
        body: formData,
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        existingDocumentId?: string;
        existingTitle?: string;
        existingVersion?: string;
        session?: GuidelineDocumentSession;
      };

      if (res.status === 409 && body.code === "DUPLICATE_GUIDELINE_DOCUMENT") {
        setDuplicateInfo({
          existingDocumentId: body.existingDocumentId || "",
          existingTitle: body.existingTitle || "Existing Guideline PDF",
          existingVersion: body.existingVersion || "doc-v1",
        });
        setUploadError(
          body.error ||
            "This PDF matches an already uploaded guideline document for this brand.",
        );
        return;
      }

      if (!res.ok || !body.session) {
        throw new Error(body.error || "Unable to extract guideline PDF.");
      }

      updateLocalSession(body.session);
      setActiveDocId(body.session.documentId);
      setSelectedFile(null);
      setDocTitleInput("");
      setSelectedPassage(null);
      notify(
        `Extracted ${body.session.proposals.length} candidate rule(s) from "${body.session.title}"`,
      );
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Unable to process uploaded PDF.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleOpenSourcePdf = async (session: GuidelineDocumentSession) => {
    setLoadingPdfPreview(true);
    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const params = new URLSearchParams({ organisationId });
      const res = await fetch(
        `/api/guidelines/documents/${encodeURIComponent(session.documentId)}/file?${params.toString()}`,
        { headers },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || "Unable to retrieve source PDF.");
      }
      const blob = await res.blob();
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
      const nextUrl = URL.createObjectURL(blob);
      setPdfPreviewUrl(nextUrl);
      setPdfPreviewTitle(`${session.title} (${session.sourceDocumentVersion})`);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Unable to open source PDF.",
        "error",
      );
    } finally {
      setLoadingPdfPreview(false);
    }
  };

  const handleDiscardSession = async (session: GuidelineDocumentSession) => {
    if (discardingDoc) return;
    setDiscardingDoc(true);
    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const params = new URLSearchParams({ organisationId });
      const res = await fetch(
        `/api/guidelines/documents/${encodeURIComponent(session.documentId)}?${params.toString()}`,
        { method: "DELETE", headers },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        deletedCompletely?: boolean;
      };
      if (!res.ok) {
        throw new Error(body.error || "Failed to discard guideline session.");
      }
      const remaining = sessions.filter(
        (s) => s.documentId !== session.documentId,
      );
      setSessions(remaining);
      setActiveDocId(remaining[0]?.documentId || "");
      notify(
        body.deletedCompletely
          ? `Discarded "${session.title}" and unpublished drafts.`
          : `Closed draft session for "${session.title}" (published rules kept with source provenance).`,
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Failed to discard guideline session.",
        "error",
      );
    } finally {
      setDiscardingDoc(false);
    }
  };

  const handleProposalMutation = async (
    proposal: KnowledgeProposal,
    action: "save_draft" | "publish" | "discard",
  ) => {
    if (!activeSession || busyProposalId) return;
    const edits =
      draftsById[proposal.proposalId] ?? createDraftEditsFromProposal(proposal);

    if (action !== "discard") {
      if (edits.title.trim().length < 2 || edits.content.trim().length < 2) {
        setProposalErrors((prev) => ({
          ...prev,
          [proposal.proposalId]:
            "Please enter both a rule title and description (at least 2 characters).",
        }));
        return;
      }
    }

    setBusyProposalId(proposal.proposalId);
    setProposalErrors((prev) => {
      const copy = { ...prev };
      delete copy[proposal.proposalId];
      return copy;
    });

    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const structuredFacts = {
        ...(proposal.structuredFacts ?? {}),
        ...(edits.productName.trim()
          ? { productName: edits.productName.trim() }
          : {}),
        ...(edits.price.trim() ? { price: edits.price.trim() } : {}),
        ...(edits.validFrom.trim()
          ? { validFrom: edits.validFrom.trim() }
          : {}),
        ...(edits.validUntil.trim()
          ? { validUntil: edits.validUntil.trim() }
          : {}),
      };
      const hasStructured = Object.keys(structuredFacts).length > 0;
      const parsedHex = parseHexCodes(edits.hexInput);

      const payload =
        action === "discard"
          ? {
              action: "discard",
              documentId: activeSession.documentId,
              proposalId: proposal.proposalId,
              organisationId,
            }
          : {
              action,
              documentId: activeSession.documentId,
              proposalId: proposal.proposalId,
              organisationId,
              title: edits.title.trim(),
              content: edits.content.trim(),
              category: edits.category,
              sectionRef: edits.sectionRef.trim(),
              ...(hasStructured ? { structuredFacts } : {}),
              ...(edits.preferredTerm.trim()
                ? { preferredTerm: edits.preferredTerm.trim() }
                : {}),
              ...(edits.avoidTerm.trim()
                ? { avoidTerm: edits.avoidTerm.trim() }
                : {}),
              ...(parsedHex ? { hexCodes: parsedHex } : {}),
              ...(edits.fontFamily.trim()
                ? { fontFamily: edits.fontFamily.trim() }
                : {}),
              conflictResolution: edits.conflictResolution,
              ...(action === "publish"
                ? {
                    publishIdempotencyKey: `proposal:${activeSession.documentId}:${proposal.proposalId}`,
                  }
                : {}),
            };

      const res = await fetch("/api/guidelines/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        session?: GuidelineDocumentSession;
        proposal?: KnowledgeProposal;
        deduplicated?: boolean;
      };

      if (!res.ok || !body.session) {
        throw new Error(body.error || `Unable to ${action.replace("_", " ")} proposal.`);
      }

      updateLocalSession(body.session);

      if (action === "publish") {
        await reloadSelectedBrandKnowledge();
        notify(
          body.deduplicated
            ? `"${edits.title.trim()}" is already published to ${selectedBrand?.brandName || "brand"}.`
            : `Published "${edits.title.trim()}" to ${selectedBrand?.brandName || "brand"} Knowledge Hub.`,
        );
      } else if (action === "save_draft") {
        notify(`Saved draft proposal "${edits.title.trim()}".`);
      } else {
        notify("Proposal discarded.");
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to update proposal.";
      setProposalErrors((prev) => ({
        ...prev,
        [proposal.proposalId]: msg,
      }));
    } finally {
      setBusyProposalId("");
    }
  };

  const capturePageSelection = (pageNumber: number) => {
    const pre = pageTextRefs.current.get(pageNumber);
    const selection = window.getSelection();
    if (!pre || !selection || selection.isCollapsed) return;
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (text.length < 10) return;
    setSelectedPassage({ pageNumber, text });
  };

  const handleAddManualProposal = async () => {
    if (!activeSession || !selectedPassage || addingManual) return;
    setAddingManual(true);
    try {
      const { organisationId, headers } = getKnowledgeRequestContext();
      const res = await fetch("/api/guidelines/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          action: "add_manual_proposal",
          documentId: activeSession.documentId,
          organisationId,
          extractedText: selectedPassage.text,
          pageNumber: selectedPassage.pageNumber,
          ...(manualSectionRef.trim()
            ? { sectionRef: manualSectionRef.trim() }
            : {}),
          category: manualCategory,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        session?: GuidelineDocumentSession;
      };
      if (!res.ok || !body.session) {
        throw new Error(body.error || "Unable to add proposal from passage.");
      }
      updateLocalSession(body.session);
      setSelectedPassage(null);
      setManualSectionRef("");
      window.getSelection()?.removeAllRanges();
      notify(`Added proposal from page ${selectedPassage.pageNumber}.`);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Unable to add selected passage.",
        "error",
      );
    } finally {
      setAddingManual(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Brand Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#6B6560]">
            Guideline Document Intelligence &amp; Review Staging
          </p>
          <h2 className="text-xl font-bold tracking-tight text-[#141414]">
            Brand Guideline PDFs
          </h2>
          <p className="mt-1 text-xs text-[#524E4A]">
            Upload official brand PDFs, review classified rules with exact source provenance, resolve conflicts, and publish safely to the selected brand.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {selectedBrand && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E2DBFB] px-3.5 py-1.5 text-xs font-semibold text-[#141414]">
              <Building2 className="w-3.5 h-3.5" />
              Active Brand: {selectedBrand.brandName}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadSessions()}
            disabled={loadingSessions}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E1DA] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#141414] hover:border-[#141414] disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadingSessions ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Upload Card + Session Selector */}
      <section className="grid grid-cols-1 xl:grid-cols-[minmax(330px,0.85fr)_minmax(0,1.15fr)] gap-5 items-start">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPdfUpload();
          }}
          className="bg-white border border-[#E7E1DA] rounded-[24px] p-5 space-y-4"
        >
          <div>
            <h3 className="text-base font-bold text-[#141414]">
              Upload Brand Guideline PDF
            </h3>
            <p className="mt-1 text-xs text-[#6B6560]">
              All extracted text and proposals stay staged as unpublished drafts until you explicitly publish them.
            </p>
          </div>

          {uploadError && (
            <div
              role="alert"
              className="rounded-2xl bg-[#F6D5DA]/65 border border-[#EBC3CA] p-3.5 text-xs text-[#7F1D1D] space-y-2.5"
            >
              <p className="font-medium">{uploadError}</p>
              <div className="flex flex-wrap gap-2">
                {duplicateInfo ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (duplicateInfo.existingDocumentId) {
                          setActiveDocId(duplicateInfo.existingDocumentId);
                        }
                        setUploadError("");
                        setDuplicateInfo(null);
                      }}
                      className="rounded-full bg-[#141414] px-3 py-1.5 text-[11px] font-semibold text-white"
                    >
                      Resume Existing Session
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitPdfUpload({ allowDuplicate: true })}
                      className="rounded-full border border-[#7F1D1D]/40 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#7F1D1D]"
                    >
                      Upload as Separate Copy
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void submitPdfUpload()}
                    disabled={!selectedFile || uploading}
                    className="rounded-full bg-[#141414] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    Retry Upload
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-[#3F3B37] mb-1">
                Document Title
              </span>
              <input
                type="text"
                value={docTitleInput}
                onChange={(e) => setDocTitleInput(e.target.value)}
                placeholder="e.g., 2026 Brand Guidelines"
                className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-[#3F3B37] mb-1">
                Document Version
              </span>
              <input
                type="text"
                value={docVersionInput}
                onChange={(e) => setDocVersionInput(e.target.value)}
                placeholder="doc-v1"
                className="w-full px-3 py-2 rounded-xl border border-[#E7E1DA] text-xs font-mono text-[#141414] focus:outline-none focus:border-[#141414]"
              />
            </label>
          </div>

          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#DED6CE] bg-[#FAF8F6] px-4 py-5 text-center hover:border-[#141414]">
            <Upload className="w-5 h-5 text-[#524E4A] mb-2" />
            <span className="text-xs font-semibold text-[#141414]">
              {selectedFile ? selectedFile.name : "Choose a guideline PDF file"}
            </span>
            <span className="mt-1 text-[11px] text-[#6B6560]">
              PDF only · up to 20 MB · private workspace storage
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setDuplicateInfo(null);
                if (!file) {
                  setSelectedFile(null);
                  setUploadError("");
                  return;
                }
                const lower = file.name.toLowerCase();
                if (!lower.endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
                  setSelectedFile(null);
                  setUploadError(
                    `Unsupported file "${file.name}". Please choose a valid .pdf guideline document.`,
                  );
                  e.target.value = "";
                  return;
                }
                if (file.size === 0) {
                  setSelectedFile(null);
                  setUploadError("The selected PDF file is empty (0 bytes).");
                  e.target.value = "";
                  return;
                }
                if (file.size > 20 * 1024 * 1024) {
                  setSelectedFile(null);
                  setUploadError(
                    "The selected PDF exceeds the 20 MB guideline upload limit.",
                  );
                  e.target.value = "";
                  return;
                }
                setSelectedFile(file);
                setUploadError("");
                if (!docTitleInput.trim()) {
                  setDocTitleInput(defaultTitleFromFileName(file.name));
                }
              }}
              className="sr-only"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-[#3F3B37] cursor-pointer">
            <input
              type="checkbox"
              checked={enableOcr}
              onChange={(e) => setEnableOcr(e.target.checked)}
              className="rounded border-[#DED6CE]"
            />
            <span>Run scanned-page text recovery if pages have no embedded text</span>
          </label>

          <button
            type="submit"
            disabled={uploading || !selectedBrandId}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#141414] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#2A2A2A] disabled:cursor-wait disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSearch className="w-3.5 h-3.5" />
            )}
            {uploading
              ? "Validating & extracting pages…"
              : "Upload & Extract Rules"}
          </button>
        </form>

        <div className="space-y-4">
          <div className="bg-[#DDF0FA]/70 border border-[#CBE2EF] rounded-[24px] p-5">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 mt-0.5 text-[#24516B] shrink-0" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#141414]">
                  Durable staging &amp; conflict protection
                </h3>
                <p className="text-xs leading-relaxed text-[#3F3B37]">
                  Uploaded documents, page text, and draft edits survive page reloads. Every proposed rule retains its locked source excerpt and is checked for price, date, colour, or terminology conflicts against currently published brand rules before publishing.
                </p>
              </div>
            </div>
          </div>

          {loadError && (
            <div
              role="alert"
              className="rounded-2xl bg-[#F6D5DA]/60 border border-[#EBC3CA] px-4 py-3 text-xs text-[#7F1D1D]"
            >
              {loadError}
            </div>
          )}

          {loadingSessions && sessions.length === 0 ? (
            <div className="bg-white border border-[#E7E1DA] rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-3.5 w-44 rounded-full bg-[#F3EDE8]" />
              <div className="h-9 w-full rounded-xl bg-[#FAF8F6]" />
            </div>
          ) : sessions.length > 0 ? (
            <div className="bg-white border border-[#E7E1DA] rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="guideline-session-select"
                  className="text-xs font-semibold text-[#3F3B37]"
                >
                  Saved Guideline Sessions ({sessions.length})
                </label>
                {activeSession && (
                  <button
                    type="button"
                    disabled={discardingDoc}
                    onClick={() => void handleDiscardSession(activeSession)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7F1D1D] hover:underline disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                    {discardingDoc ? "Discarding…" : "Discard Session"}
                  </button>
                )}
              </div>

              <select
                id="guideline-session-select"
                value={activeDocId}
                onChange={(e) => {
                  setActiveDocId(e.target.value);
                  setSelectedPassage(null);
                }}
                className="w-full rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] px-3 py-2 text-sm text-[#141414]"
              >
                {sessions.map((s) => {
                  const openCount = s.proposals.filter(
                    (p) =>
                      p.status === "pending_review" ||
                      p.status === "draft_saved",
                  ).length;
                  return (
                    <option key={s.documentId} value={s.documentId}>
                      {s.title} · {s.sourceDocumentVersion} ({s.totalPageCount}{" "}
                      pages · {openCount} open)
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div className="rounded-[24px] border border-[#E7E1DA] bg-white p-8 text-center">
              <FileText className="mx-auto h-7 w-7 text-[#8E8780]" />
              <p className="mt-3 text-sm font-semibold text-[#141414]">
                {!selectedBrandId
                  ? persistenceMode === "CONFIGURED_UNAUTHENTICATED"
                    ? "Sign in or switch to Demo mode to inspect guideline PDFs"
                    : "Select or create a brand to stage guideline PDFs"
                  : `No guideline PDFs staged for ${selectedBrand?.brandName || "this brand"} yet`}
              </p>
              <p className="mt-1 text-xs text-[#6B6560]">
                {!selectedBrandId
                  ? "Guideline extraction sessions are strictly scoped to the selected brand profile."
                  : "Upload a guideline PDF on the left to extract candidate rules, facts, colours, and terminology."}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Active Document Workspace */}
      {activeSession && (
        <div className="space-y-6">
          {/* Document Status Strip */}
          <section className="bg-white border border-[#E7E1DA] rounded-[24px] p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-[#6B6560]">
                    {activeSession.fileName}
                  </span>
                  <span className="rounded-full bg-[#FAF8F6] border border-[#E7E1DA] px-2.5 py-0.5 text-[11px] font-semibold text-[#3F3B37]">
                    {activeSession.sourceDocumentVersion}
                  </span>
                  {activeSession.ocrUsed && (
                    <span className="rounded-full bg-[#FAF0C8] border border-[#E9DFAF] px-2.5 py-0.5 text-[11px] font-semibold text-[#664D03]">
                      OCR Used ({activeSession.ocrPageCount} scanned page
                      {activeSession.ocrPageCount === 1 ? "" : "s"})
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-bold text-[#141414]">
                  {activeSession.title}
                </h3>
                <p className="text-xs text-[#524E4A]">
                  {activeSession.totalPageCount} pages · Uploaded by{" "}
                  {activeSession.uploadedBy} ·{" "}
                  <button
                    type="button"
                    disabled={loadingPdfPreview}
                    onClick={() => void handleOpenSourcePdf(activeSession)}
                    className="inline-flex items-center gap-1 font-semibold text-[#141414] underline decoration-[#8E8780] hover:decoration-[#141414] disabled:opacity-50"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {loadingPdfPreview ? "Opening PDF…" : "View Source PDF"}
                  </button>
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
                <StatChip
                  label="Open Review"
                  count={counts.pending}
                  className="bg-[#FAF0C8] border-[#E9DFAF] text-[#664D03]"
                />
                <StatChip
                  label="Needs Review"
                  count={counts.needsReview}
                  className="bg-[#E2DBFB] border-[#D3CAEE] text-[#3B2667]"
                />
                <StatChip
                  label="Conflicts"
                  count={counts.conflicts}
                  className="bg-[#F6D5DA] border-[#EBC3CA] text-[#7F1D1D]"
                />
                <StatChip
                  label="Published"
                  count={counts.published}
                  className="bg-[#CDEEE0] border-[#BAE0D0] text-[#14532D]"
                />
              </div>
            </div>

            {activeSession.warnings.length > 0 && (
              <div className="rounded-2xl border border-[#E9DFAF] bg-[#FAF0C8]/60 px-4 py-3 text-xs text-[#664D03] space-y-1">
                {activeSession.warnings.map((w, i) => (
                  <p key={`doc-warn-${i}`}>• {w}</p>
                ))}
              </div>
            )}
          </section>

          {/* 2-column Page Viewer + Proposals Review */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Left: Page-by-page source viewer */}
            <div className="xl:col-span-5 space-y-4">
              <div>
                <h3 className="text-base font-bold text-[#141414]">
                  Extracted Pages
                </h3>
                <p className="mt-1 text-xs text-[#6B6560]">
                  Inspect page text or highlight any passage to create an additional rule proposal linked to that page.
                </p>
              </div>

              {selectedPassage && (
                <div className="rounded-2xl border border-[#D3CAEE] bg-[#E2DBFB]/55 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-[#141414]">
                      Selected from Page {selectedPassage.pageNumber}
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedPassage(null)}
                      aria-label="Clear selected passage"
                      className="p-1 rounded-lg hover:bg-white/60"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs italic text-[#2B2927] bg-white/70 rounded-xl p-2.5">
                    &ldquo;{selectedPassage.text}&rdquo;
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={manualSectionRef}
                      onChange={(e) => setManualSectionRef(e.target.value)}
                      placeholder="Section heading (optional)"
                      className="rounded-xl border border-[#E7E1DA] bg-white px-3 py-2 text-xs text-[#141414]"
                    />
                    <select
                      value={manualCategory}
                      onChange={(e) =>
                        setManualCategory(e.target.value as KnowledgeSection)
                      }
                      className="rounded-xl border border-[#E7E1DA] bg-white px-3 py-2 text-xs text-[#141414]"
                    >
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={addingManual}
                    onClick={() => void handleAddManualProposal()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#141414] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2A2A2A] disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {addingManual
                      ? "Adding proposal…"
                      : "Add Selected Text as Proposal"}
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {activeSession.pages.map((page) => (
                  <details
                    key={page.pageNumber}
                    open={page.pageNumber === 1}
                    className="overflow-hidden rounded-[20px] border border-[#E7E1DA] bg-white"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#F3EDE8]/70 px-4 py-3">
                      <span className="text-xs font-bold text-[#141414]">
                        Page {page.pageNumber}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          page.status === "TEXT_EXTRACTED"
                            ? "bg-[#CDEEE0] text-[#14532D]"
                            : page.status === "OCR_EXTRACTED"
                              ? "bg-[#FAF0C8] text-[#664D03]"
                              : page.status === "PAGE_FAILED"
                                ? "bg-[#F6D5DA] text-[#7F1D1D]"
                                : "bg-white text-[#524E4A]"
                        }`}
                      >
                        {page.status === "TEXT_EXTRACTED"
                          ? "Embedded text"
                          : page.status === "OCR_EXTRACTED"
                            ? `Recovered via OCR${
                                typeof page.ocrConfidence === "number"
                                  ? ` (${Math.round(page.ocrConfidence * 100)}%)`
                                  : ""
                              }`
                            : page.status === "PAGE_FAILED"
                              ? "Page error"
                              : "No extractable text"}
                      </span>
                    </summary>

                    {page.warnings.length > 0 && (
                      <div className="border-b border-[#EFECE7] bg-[#FAF0C8]/45 px-4 py-2 text-[11px] text-[#664D03]">
                        {page.warnings.map((w, idx) => (
                          <p key={`pw-${page.pageNumber}-${idx}`}>{w}</p>
                        ))}
                      </div>
                    )}

                    {page.text ? (
                      <pre
                        ref={(el) => {
                          if (el) pageTextRefs.current.set(page.pageNumber, el);
                          else pageTextRefs.current.delete(page.pageNumber);
                        }}
                        onMouseUp={() => capturePageSelection(page.pageNumber)}
                        className="select-text whitespace-pre-wrap break-words px-4 py-3.5 text-xs leading-relaxed text-[#2B2927] font-sans"
                      >
                        {page.text}
                      </pre>
                    ) : (
                      <p className="px-4 py-4 text-xs text-[#6B6560]">
                        {page.error ||
                          "No readable text was extracted from this page."}
                      </p>
                    )}
                  </details>
                ))}
              </div>
            </div>

            {/* Right: Staged Proposals with Uncertainty + Conflict Detection */}
            <div className="xl:col-span-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[#141414]">
                    Proposed Knowledge Entries ({counts.total})
                  </h3>
                  <p className="mt-1 text-xs text-[#6B6560]">
                    Review category placement, verify OCR wording, resolve any rule conflicts, and publish approved items.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[#E7E1DA] bg-[#F3EDE8] p-1">
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "needs_review", label: "Needs Review" },
                      { id: "conflicts", label: "Conflicts" },
                      { id: "published", label: "Published" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setProposalFilter(tab.id)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        proposalFilter === tab.id
                          ? "bg-[#141414] text-white"
                          : "text-[#524E4A] hover:text-[#141414]"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {visibleProposals.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[#D3CCC4] bg-white p-8 text-center">
                  <p className="text-sm font-semibold text-[#141414]">
                    No proposals match this filter
                  </p>
                  <p className="mt-1 text-xs text-[#6B6560]">
                    Switch filters above or highlight text in the Extracted Pages column to add a custom proposal.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleProposals.map((proposal) => {
                    const edits =
                      draftsById[proposal.proposalId] ??
                      createDraftEditsFromProposal(proposal);
                    const isPublished = proposal.status === "published";
                    const isBusy = busyProposalId === proposal.proposalId;
                    const cardError = proposalErrors[proposal.proposalId];
                    const hasConflict =
                      !isPublished &&
                      (proposal.conflictStatus === "conflict" ||
                        proposal.conflictStatus === "possible_conflict") &&
                      (proposal.conflictMatches?.length ?? 0) > 0;
                    const conflictBlocksDirectPublish =
                      !isPublished &&
                      proposal.conflictStatus === "conflict" &&
                      edits.conflictResolution !==
                        "publish_and_archive_existing" &&
                      edits.conflictResolution !== "publish_coexisting";

                    return (
                      <article
                        key={proposal.proposalId}
                        className="rounded-[22px] border border-[#E7E1DA] bg-white p-5 space-y-4"
                      >
                        {/* Top Provenance & Status Row */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                                isPublished
                                  ? "bg-[#CDEEE0] text-[#14532D]"
                                  : proposal.status === "draft_saved"
                                    ? "bg-[#DDF0FA] text-[#0C4A6E]"
                                    : "bg-[#FAF0C8] text-[#664D03]"
                              }`}
                            >
                              {isPublished ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <Clock3 className="w-3 h-3" />
                              )}
                              {isPublished
                                ? `Published (${proposal.publishedVersionId || "active"})`
                                : proposal.status === "draft_saved"
                                  ? "Draft Saved"
                                  : "Pending Review"}
                            </span>

                            <span className="rounded-full bg-[#FAF8F6] border border-[#E7E1DA] px-2.5 py-0.5 font-medium text-[#3F3B37]">
                              Page {proposal.pageNumber}
                              {proposal.sectionRef
                                ? ` · ${proposal.sectionRef}`
                                : ""}
                            </span>

                            <span className="rounded-full bg-[#FAF8F6] border border-[#E7E1DA] px-2.5 py-0.5 font-medium text-[#524E4A]">
                              {proposal.extractionSource === "ocr"
                                ? `OCR text${
                                    typeof proposal.ocrConfidence === "number"
                                      ? ` (${Math.round(proposal.ocrConfidence * 100)}%)`
                                      : ""
                                  }`
                                : proposal.extractionSource === "manual_selection"
                                  ? "Selected passage"
                                  : "Embedded text"}
                            </span>

                            {(proposal.classificationUncertain ||
                              proposal.requiresHumanReview) &&
                              !isPublished && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[#F9DEC0] border border-[#E7C6A2] px-2.5 py-0.5 font-semibold text-[#7C2D12]">
                                  <AlertTriangle className="w-3 h-3" />
                                  Needs human review
                                </span>
                              )}
                          </div>
                        </div>

                        {proposal.uncertaintyReason && !isPublished && (
                          <p className="rounded-xl bg-[#FAF0C8]/65 border border-[#E9DFAF] px-3 py-2 text-[11px] text-[#664D03]">
                            {proposal.uncertaintyReason}
                          </p>
                        )}

                        {/* Bounded Conflict Alert Panel */}
                        {hasConflict && proposal.conflictMatches && (
                          <div
                            className={`rounded-2xl border p-4 space-y-3 ${
                              proposal.conflictStatus === "conflict"
                                ? "bg-[#F6D5DA]/50 border-[#EBC3CA]"
                                : "bg-[#FAF0C8]/55 border-[#E9DFAF]"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <ShieldAlert
                                className={`w-4 h-4 mt-0.5 shrink-0 ${
                                  proposal.conflictStatus === "conflict"
                                    ? "text-[#7F1D1D]"
                                    : "text-[#664D03]"
                                }`}
                              />
                              <div>
                                <p className="text-xs font-bold text-[#141414]">
                                  {proposal.conflictStatus === "conflict"
                                    ? "Conflicts with existing published brand knowledge"
                                    : "Possible overlap or conflict detected"}
                                </p>
                                <p className="text-[11px] text-[#3F3B37] mt-0.5">
                                  Review both statements below and select a resolution before publishing.
                                </p>
                              </div>
                            </div>

                            {proposal.conflictMatches.map((match) => (
                              <div
                                key={`${proposal.proposalId}-${match.existingEntryId}`}
                                className="rounded-xl bg-white/85 border border-black/10 p-3 space-y-2 text-[11px]"
                              >
                                <p className="font-semibold text-[#141414]">
                                  {match.reason}
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                  <div className="rounded-lg bg-[#FAF8F6] border border-[#E7E1DA] p-2.5">
                                    <p className="font-bold uppercase tracking-wide text-[10px] text-[#524E4A]">
                                      Existing Published ({match.existingVersionId})
                                    </p>
                                    <p className="mt-1 text-[#141414]">
                                      {match.existingStatement}
                                    </p>
                                    <p className="mt-1 text-[10px] text-[#6B6560]">
                                      Source: {match.existingSourceTitle}
                                      {match.existingSourceDocumentVersion
                                        ? ` (${match.existingSourceDocumentVersion})`
                                        : ""}
                                      {match.existingPageNumber
                                        ? ` · p.${match.existingPageNumber}`
                                        : ""}
                                    </p>
                                  </div>
                                  <div className="rounded-lg bg-[#E2DBFB]/40 border border-[#D3CAEE] p-2.5">
                                    <p className="font-bold uppercase tracking-wide text-[10px] text-[#3B2667]">
                                      New Proposal (p.{proposal.pageNumber})
                                    </p>
                                    <p className="mt-1 text-[#141414]">
                                      {match.proposalStatement}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}

                            <div className="space-y-1.5 pt-1">
                              <label className="block text-[11px] font-bold text-[#141414]">
                                Choose Conflict Resolution
                              </label>
                              <select
                                value={edits.conflictResolution}
                                onChange={(e) => {
                                  const val = e.target
                                    .value as ConflictResolution;
                                  setDraftsById((prev) => ({
                                    ...prev,
                                    [proposal.proposalId]: {
                                      ...edits,
                                      conflictResolution: val,
                                    },
                                  }));
                                }}
                                className="w-full rounded-xl border border-[#E7E1DA] bg-white px-3 py-2 text-xs text-[#141414]"
                              >
                                <option value="unresolved">
                                  Select how to resolve this conflict…
                                </option>
                                <option value="keep_existing">
                                  Keep existing published rule (discard proposal)
                                </option>
                                <option value="publish_and_archive_existing">
                                  Publish new rule &amp; archive conflicting published rule
                                </option>
                                <option value="publish_coexisting">
                                  Publish alongside existing rule (keep both)
                                </option>
                              </select>
                            </div>
                          </div>
                        )}

                        {/* Immutable Source Excerpt */}
                        <div className="rounded-xl border border-[#D3CAEE] bg-[#E2DBFB]/35 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#524E4A]">
                            Original Extracted Source Text (Locked Provenance)
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#2B2927]">
                            {proposal.extractedText}
                          </p>
                        </div>

                        {/* Editable Fields */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="block">
                            <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                              Knowledge Category
                            </span>
                            <select
                              disabled={isPublished}
                              value={edits.category}
                              onChange={(e) =>
                                setDraftsById((prev) => ({
                                  ...prev,
                                  [proposal.proposalId]: {
                                    ...edits,
                                    category: e.target
                                      .value as KnowledgeSection,
                                  },
                                }))
                              }
                              className="w-full rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] px-3 py-2 text-xs text-[#141414] disabled:opacity-65"
                            >
                              {CATEGORY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                  {opt.value === proposal.suggestedCategory
                                    ? " (Suggested)"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                              Section Heading (from PDF)
                            </span>
                            <input
                              type="text"
                              disabled={isPublished}
                              value={edits.sectionRef}
                              onChange={(e) =>
                                setDraftsById((prev) => ({
                                  ...prev,
                                  [proposal.proposalId]: {
                                    ...edits,
                                    sectionRef: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Optional section reference"
                              className="w-full rounded-xl border border-[#E7E1DA] px-3 py-2 text-xs text-[#141414] disabled:bg-[#FAF8F6]"
                            />
                          </label>
                        </div>

                        <label className="block">
                          <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                            Rule / Fact Title
                          </span>
                          <input
                            type="text"
                            disabled={isPublished}
                            value={edits.title}
                            onChange={(e) =>
                              setDraftsById((prev) => ({
                                ...prev,
                                [proposal.proposalId]: {
                                  ...edits,
                                  title: e.target.value,
                                },
                              }))
                            }
                            className="w-full rounded-xl border border-[#E7E1DA] px-3 py-2 text-xs font-semibold text-[#141414] disabled:bg-[#FAF8F6]"
                          />
                        </label>

                        <label className="block">
                          <span className="block text-[11px] font-semibold text-[#3F3B37] mb-1">
                            Reviewed Guidance / Verified Fact Content
                          </span>
                          <textarea
                            rows={3}
                            disabled={isPublished}
                            value={edits.content}
                            onChange={(e) =>
                              setDraftsById((prev) => ({
                                ...prev,
                                [proposal.proposalId]: {
                                  ...edits,
                                  content: e.target.value,
                                },
                              }))
                            }
                            className="w-full rounded-xl border border-[#E7E1DA] px-3 py-2 text-xs leading-relaxed text-[#141414] disabled:bg-[#FAF8F6]"
                          />
                        </label>

                        {/* Structured Metadata Preview / Edit */}
                        {(edits.category === "facts" ||
                          edits.category === "visual" ||
                          edits.category === "terminology" ||
                          edits.category === "prohibited" ||
                          Boolean(proposal.structuredFacts) ||
                          Boolean(proposal.hexCodes?.length)) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 rounded-xl bg-[#FAF8F6] border border-[#E7E1DA] p-3">
                            {(edits.category === "facts" ||
                              edits.productName ||
                              edits.price ||
                              edits.validUntil) && (
                              <>
                                <label className="block">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Product / Entity
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.productName}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          productName: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Product name"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Price
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.price}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          price: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="e.g. $24.00"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Valid From
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.validFrom}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          validFrom: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="YYYY-MM-DD"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Valid Until
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.validUntil}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          validUntil: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="YYYY-MM-DD"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                              </>
                            )}

                            {(edits.category === "terminology" ||
                              edits.category === "prohibited" ||
                              edits.preferredTerm ||
                              edits.avoidTerm) && (
                              <>
                                <label className="block sm:col-span-2">
                                  <span className="block text-[10px] font-semibold text-[#14532D] mb-1">
                                    Preferred Term
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.preferredTerm}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          preferredTerm: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Approved wording"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                                <label className="block sm:col-span-2">
                                  <span className="block text-[10px] font-semibold text-[#7F1D1D] mb-1">
                                    Avoid / Prohibited Term
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.avoidTerm}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          avoidTerm: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Restricted wording"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                              </>
                            )}

                            {(edits.category === "visual" ||
                              edits.hexInput ||
                              edits.fontFamily) && (
                              <>
                                <label className="block sm:col-span-2">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Hex Colours (#RRGGBB)
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.hexInput}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          hexInput: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="#064E3B, #FAF8F6"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px] font-mono"
                                  />
                                </label>
                                <label className="block sm:col-span-2">
                                  <span className="block text-[10px] font-semibold text-[#6B6560] mb-1">
                                    Typeface
                                  </span>
                                  <input
                                    type="text"
                                    disabled={isPublished}
                                    value={edits.fontFamily}
                                    onChange={(e) =>
                                      setDraftsById((prev) => ({
                                        ...prev,
                                        [proposal.proposalId]: {
                                          ...edits,
                                          fontFamily: e.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Font family"
                                    className="w-full rounded-lg border border-[#E7E1DA] bg-white px-2.5 py-1.5 text-[11px]"
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        )}

                        {cardError && (
                          <p
                            role="alert"
                            className="rounded-xl bg-[#F6D5DA]/60 border border-[#EBC3CA] px-3 py-2 text-xs text-[#7F1D1D]"
                          >
                            {cardError}
                          </p>
                        )}

                        {/* Actions */}
                        {!isPublished && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EFECE7] pt-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleProposalMutation(
                                    proposal,
                                    "save_draft",
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E1DA] px-3.5 py-2 text-xs font-semibold text-[#3F3B37] hover:bg-[#FAF8F6] disabled:opacity-50"
                              >
                                <Save className="w-3.5 h-3.5" />
                                {isBusy ? "Saving…" : "Save Draft"}
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleProposalMutation(
                                    proposal,
                                    "discard",
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#F6D5DA]/70 px-3.5 py-2 text-xs font-semibold text-[#7F1D1D] hover:bg-[#F6D5DA] disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Discard
                              </button>
                            </div>

                            {edits.conflictResolution === "keep_existing" ? (
                              <span className="text-[11px] font-medium text-[#7F1D1D]">
                                Resolution set to keep existing rule — click Discard above.
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy || conflictBlocksDirectPublish}
                                onClick={() =>
                                  void handleProposalMutation(
                                    proposal,
                                    "publish",
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#141414] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2B2B2B] disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <UploadCloud className="w-3.5 h-3.5" />
                                {isBusy
                                  ? "Publishing…"
                                  : edits.conflictResolution ===
                                      "publish_and_archive_existing"
                                    ? "Publish & Replace Existing"
                                    : "Publish to Brand"}
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Private Source PDF Inline Modal */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[24px] max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#E7E1DA] bg-[#FAF8F6]">
              <p className="text-sm font-bold text-[#141414] truncate">
                {pdfPreviewTitle}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={pdfPreviewUrl}
                  download={`${pdfPreviewTitle.replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`}
                  className="rounded-full border border-[#E7E1DA] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#141414] hover:border-[#141414]"
                >
                  Download PDF
                </a>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(pdfPreviewUrl);
                    setPdfPreviewUrl(null);
                  }}
                  aria-label="Close source PDF preview"
                  className="p-1.5 rounded-lg hover:bg-[#EFECE7]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <iframe
              src={pdfPreviewUrl}
              title={pdfPreviewTitle}
              className="w-full flex-1 bg-[#F3EDE8]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className: string;
}) {
  return (
    <div className={`min-w-[78px] rounded-xl border px-3 py-2 ${className}`}>
      <p className="text-lg font-bold tabular-nums leading-none">{count}</p>
      <p className="mt-1 text-[10px] font-semibold">{label}</p>
    </div>
  );
}
