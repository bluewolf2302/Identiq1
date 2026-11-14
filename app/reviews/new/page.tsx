"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { GUIDELINE_COLLECTIONS } from "@/lib/seed-data";
import {
  AnalysisResponsePayload,
  ContentType,
  PastelTheme,
  ReviewSubmission,
} from "@/lib/types";

const CONTENT_TYPES: ContentType[] = [
  "Campaign Copy",
  "Social Creative",
  "Product Sheet",
  "Press Release",
  "Landing Page",
];

const MAX_CREATIVE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB default matching server config
const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

type SubmissionStage =
  | "idle"
  | "reading"
  | "uploading"
  | "analyzing"
  | "complete";

const STAGE_STEPS: Array<{ key: SubmissionStage; label: string }> = [
  { key: "reading", label: "Validating file & preparing payload" },
  { key: "uploading", label: "Uploading creative to Identiq server" },
  { key: "analyzing", label: "Extracting OCR text, checking brand visuals & running AI governance" },
  { key: "complete", label: "Review ready" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function estimatePdfPageCountFromText(rawLatin1: string): number | undefined {
  const matches = rawLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
  return matches && matches.length > 0 ? matches.length : undefined;
}

export default function NewReviewPage() {
  const router = useRouter();
  const { knowledge, addReview, settings, notify } = useIdentiq();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType>("Campaign Copy");
  const [guidelineCollection, setGuidelineCollection] = useState(GUIDELINE_COLLECTIONS[0]);
  const [textContent, setTextContent] = useState("");
  const [assetName, setAssetName] = useState<string | undefined>(undefined);
  const [assetSizeBytes, setAssetSizeBytes] = useState<number | undefined>(undefined);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState<string | undefined>(undefined);
  const [assetBase64, setAssetBase64] = useState<string | undefined>(undefined);
  const [assetMimeType, setAssetMimeType] = useState<string | undefined>(undefined);
  const [pdfEstimatedPages, setPdfEstimatedPages] = useState<number | undefined>(undefined);

  const [fileError, setFileError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [stage, setStage] = useState<SubmissionStage>("idle");
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  const isSubmitting = stage !== "idle" && stage !== "complete";

  const clearAttachment = () => {
    setAssetName(undefined);
    setAssetSizeBytes(undefined);
    setAssetPreviewUrl(undefined);
    setAssetBase64(undefined);
    setAssetMimeType(undefined);
    setPdfEstimatedPages(undefined);
    setFileError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError("");
    setErrorMessage("");

    const lowerName = file.name.toLowerCase();
    const ext = lowerName.includes(".") ? `.${lowerName.split(".").pop()}` : "";

    // Text files still supported for convenience
    if (file.type === "text/plain" || ext === ".txt" || ext === ".md") {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setTextContent(reader.result.slice(0, 8000));
        }
      };
      reader.readAsText(file);
      clearAttachment();
      return;
    }

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      setFileError(
        `Unsupported format "${ext || "unknown"}". Please attach a JPG, JPEG, PNG, WEBP, or PDF file.`,
      );
      e.target.value = "";
      return;
    }

    if (file.size === 0) {
      setFileError("The selected file is empty (0 bytes).");
      e.target.value = "";
      return;
    }

    if (file.size > MAX_CREATIVE_SIZE_BYTES) {
      setFileError(
        `File size (${formatBytes(file.size)}) exceeds the 15.00 MB limit.`,
      );
      e.target.value = "";
      return;
    }

    setAssetName(file.name);
    setAssetSizeBytes(file.size);
    setAssetMimeType(
      file.type || (ext === ".pdf" ? "application/pdf" : "application/octet-stream"),
    );

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const commaIndex = reader.result.indexOf(",");
      const rawBase64 = commaIndex !== -1 ? reader.result.slice(commaIndex + 1) : reader.result;
      setAssetBase64(rawBase64);

      if (ext === ".pdf") {
        setAssetPreviewUrl(undefined);
        try {
          const decodedSample = atob(rawBase64.slice(0, 120_000));
          setPdfEstimatedPages(estimatePdfPageCountFromText(decodedSample));
        } catch {
          setPdfEstimatedPages(undefined);
        }
      } else {
        setPdfEstimatedPages(undefined);
        setAssetPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const loadTeraluneSamplePdf = async () => {
    setIsLoadingSample(true);
    setFileError("");
    setErrorMessage("");
    try {
      const res = await fetch("/api/samples/teralune-ad");
      if (!res.ok) {
        throw new Error("Could not load Teralune sample advertisement PDF.");
      }
      const data = (await res.json()) as {
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        base64Data: string;
      };
      setTitle("Teralune Summer Refreshment Advertisement");
      setContentType("Campaign Copy");
      setGuidelineCollection("Teralune Brand Identity & AI Guidelines v1.0");
      setTextContent(""); // Let OCR + PDF text extraction read the actual PDF!
      setAssetName(data.fileName);
      setAssetMimeType(data.mimeType);
      setAssetSizeBytes(data.sizeBytes);
      setAssetBase64(data.base64Data);
      setAssetPreviewUrl(undefined);
      setPdfEstimatedPages(1);
      notify("Attached Teralune test-advertisement.pdf for multimodal review", "info");
    } catch (err) {
      setFileError(
        err instanceof Error ? err.message : "Failed to load Teralune sample PDF.",
      );
    } finally {
      setIsLoadingSample(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!title.trim()) {
      setErrorMessage("Please enter a campaign or content name.");
      return;
    }
    const hasCreative = Boolean(assetBase64 && assetName);
    if (!hasCreative && textContent.trim().length < 15) {
      setErrorMessage(
        "Please enter at least 15 characters of campaign copy or attach a creative image/PDF to review.",
      );
      return;
    }

    setErrorMessage("");
    setFileError("");
    setStage("reading");

    try {
      const submissionId = `submission-${crypto.randomUUID()}`;
      const approvedRules = knowledge
        .filter((k) => k.status === "Approved")
        .map((k) => `${k.title}: ${k.content}`);

      setStage("uploading");
      const payloadPromise = fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          contentType,
          guidelineCollection,
          textContent: textContent.trim(),
          submissionId,
          assetName,
          ...(assetBase64 ? { assetBase64 } : {}),
          assetMimeType,
          knowledgeSummary: approvedRules,
        }),
      });

      setStage("analyzing");
      const res = await payloadPromise;
      const responseText = await res.text();
      let data: AnalysisResponsePayload;
      try {
        data = JSON.parse(responseText) as AnalysisResponsePayload;
      } catch {
        if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
          throw new Error(
            "Server returned an HTML error page. Please check API credentials and server logs.",
          );
        }
        throw new Error(responseText || "Analysis request failed");
      }

      if (!res.ok) {
        throw new Error(
          (data as unknown as { error?: string }).error || "Analysis request failed",
        );
      }

      setStage("complete");
      const themes: PastelTheme[] = ["pink", "peach", "lavender", "mint", "blue", "yellow"];
      const newId = data.submissionId ?? submissionId;
      const resolvedTextContent =
        textContent.trim() || data.visualSummary?.extractedText || "";
      const firstPagePreview = data.visualSummary?.pages.find((p) => p.previewDataUrl)
        ?.previewDataUrl;

      const newReview: ReviewSubmission = {
        id: newId,
        title: title.trim(),
        contentType,
        guidelineCollection,
        submittedBy: settings.reviewerName,
        submittedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
        status: data.findings.some((f) => !f.resolved && f.severity === "high")
          ? "Pending Approval"
          : "In Review",
        complianceScore: data.complianceScore,
        textContent: resolvedTextContent,
        assetUrl: assetPreviewUrl ?? firstPagePreview,
        assetName,
        findings: data.findings,
        pastelTheme: themes[Math.floor(Math.random() * themes.length)],
        providerUsed: data.providerUsed,
        analysisStatus: data.analysisStatus ?? "COMPLETED",
        analysisRunId: data.analysisRunId,
        ocrBlocks: data.ocrBlocks,
        visualSummary: data.visualSummary,
      };

      addReview(newReview);
      notify(`Analysis complete (${data.findings.length} findings generated)`);
      router.push(`/studio?id=${newId}`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to submit content for review.",
      );
      setStage("idle");
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1">
            Multimodal Submission · Copy, Creative &amp; Guidelines Check
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Submit Content for Review
          </h1>
        </div>
        <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#CDEEE0]/70 border border-[#BAE0D0] text-xs font-semibold text-[#14532D]">
          <ShieldCheck className="w-4 h-4 shrink-0" />
          <span>Active Guide: {guidelineCollection}</span>
        </div>
      </div>

      {/* Quick Teralune Multimodal Test Fixture Loader */}
      <div className="bg-[#F3EDE8] border border-[#E7E1DA] rounded-[22px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#3F3B37]">
          <Sparkles className="w-4 h-4 text-[#141414] shrink-0" />
          <span className="font-medium">
            Load the Teralune advertisement PDF fixture to test multimodal OCR, visual, and text governance:
          </span>
        </div>
        <button
          type="button"
          onClick={loadTeraluneSamplePdf}
          disabled={isLoadingSample || isSubmitting}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] text-xs font-semibold text-[#141414] transition-colors shrink-0 disabled:opacity-50"
        >
          {isLoadingSample ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileText className="w-3.5 h-3.5" />
          )}
          Attach Teralune Test PDF
        </button>
      </div>

      {/* Main Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#E7E1DA] rounded-[26px] p-6 sm:p-8 space-y-6"
      >
        {errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-2.5 bg-[#F6D5DA]/60 border border-[#EBC3CA] text-[#7F1D1D] px-4 py-3 rounded-2xl text-xs font-medium"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="sm:col-span-2">
            <label
              htmlFor="review-title"
              className="block text-xs font-semibold text-[#141414] mb-1.5"
            >
              Campaign or Content Name
            </label>
            <input
              id="review-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g., Teralune Summer Refreshment Advertisement"
              className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:bg-white focus:border-[#141414]"
            />
          </div>

          <div>
            <label
              htmlFor="content-type"
              className="block text-xs font-semibold text-[#141414] mb-1.5"
            >
              Content Type
            </label>
            <select
              id="content-type"
              value={contentType}
              onChange={(e) => setContentType(e.target.value as ContentType)}
              disabled={isSubmitting}
              className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:bg-white focus:border-[#141414]"
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="guideline-collection"
              className="block text-xs font-semibold text-[#141414] mb-1.5"
            >
              Brand / Active Guideline Version
            </label>
            <select
              id="guideline-collection"
              value={guidelineCollection}
              onChange={(e) => setGuidelineCollection(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:bg-white focus:border-[#141414]"
            >
              {GUIDELINE_COLLECTIONS.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* File Upload Dropzone */}
        <div>
          <label
            htmlFor="creative-upload-input"
            className="block text-xs font-semibold text-[#141414] mb-1.5"
          >
            Upload Creative Asset (JPG, JPEG, PNG, WEBP, or PDF · max 15 MB)
          </label>
          <label
            htmlFor="creative-upload-input"
            className="block border-2 border-dashed border-[#DED6CE] hover:border-[#141414] rounded-2xl p-6 text-center cursor-pointer bg-[#FAF8F6] transition-colors"
          >
            <Upload className="w-6 h-6 text-[#524E4A] mx-auto mb-2" />
            <p className="text-xs font-semibold text-[#141414]">
              Select advertisement image or PDF
            </p>
            <p className="text-[11px] text-[#6B6560] mt-1">
              Supports .jpg, .jpeg, .png, .webp, .pdf (up to 10 pages, 15 MB) · OCR extracts copy automatically
            </p>
            <input
              ref={fileInputRef}
              id="creative-upload-input"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.md,image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileChange}
              disabled={isSubmitting}
              className="hidden"
            />
          </label>

          {fileError && (
            <div
              role="alert"
              className="mt-2.5 flex items-center gap-2 bg-[#F6D5DA]/60 border border-[#EBC3CA] text-[#7F1D1D] px-3.5 py-2.5 rounded-xl text-xs font-medium"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {assetName && (
            <div className="mt-3 flex items-center justify-between gap-3 bg-[#CDEEE0]/50 border border-[#BAE0D0] rounded-2xl px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {assetPreviewUrl ? (
                  <img
                    src={assetPreviewUrl}
                    alt={assetName}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-xl object-cover shrink-0 border border-black/10"
                  />
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-white border border-[#E7E1DA] flex items-center justify-center shrink-0">
                    {assetMimeType === "application/pdf" ? (
                      <FileText className="w-5 h-5 text-[#141414]" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-[#141414]" />
                    )}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#141414] truncate">{assetName}</p>
                  <p className="text-[11px] text-[#14532D] flex flex-wrap items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>{assetMimeType || "Unknown MIME"}</span>
                    {assetSizeBytes !== undefined && (
                      <span>· {formatBytes(assetSizeBytes)}</span>
                    )}
                    {pdfEstimatedPages !== undefined && (
                      <span>
                        · {pdfEstimatedPages} page{pdfEstimatedPages === 1 ? "" : "s"} detected
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  aria-label="Replace attached file"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white border border-[#E7E1DA] text-[11px] font-semibold text-[#141414] hover:bg-[#FAF8F6]"
                >
                  <RefreshCw className="w-3 h-3" />
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearAttachment}
                  disabled={isSubmitting}
                  aria-label="Remove attached file"
                  className="p-1.5 rounded-lg hover:bg-black/5 text-[#3F3B37]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="campaign-copy"
            className="block text-xs font-semibold text-[#141414] mb-1.5"
          >
            Additional Campaign Copy / Notes {assetBase64 ? "(Optional — OCR & PDF text extracted automatically)" : ""}
          </label>
          <textarea
            id="campaign-copy"
            rows={5}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            disabled={isSubmitting}
            placeholder="Paste campaign copy here, or leave empty when uploading an advertisement image/PDF so Identiq extracts text via OCR..."
            className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] leading-relaxed placeholder:text-[#8E8780] focus:outline-none focus:bg-white focus:border-[#141414]"
          />
          <p className="text-[11px] text-[#6B6560] mt-1.5 tabular-nums">
            {textContent.length} manual characters · Visual pipeline runs OCR, CIEDE2000 colour checks, logo checks, typography/layout checks, and Gemini Vision
          </p>
        </div>

        {isSubmitting && (
          <div className="bg-[#FAF8F6] border border-[#E7E1DA] rounded-2xl p-4 space-y-2">
            <p className="text-xs font-bold text-[#141414]">Processing Stages</p>
            <div className="space-y-1.5">
              {STAGE_STEPS.map((s, idx) => {
                const currentIdx = STAGE_STEPS.findIndex((st) => st.key === stage);
                const done = idx < currentIdx;
                const active = idx === currentIdx;
                return (
                  <div key={s.key} className="flex items-center gap-2 text-xs">
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#14532D] shrink-0" />
                    ) : active ? (
                      <Loader2 className="w-3.5 h-3.5 text-[#141414] animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-[#CFC7BE] shrink-0" />
                    )}
                    <span className={active ? "font-semibold text-[#141414]" : "text-[#524E4A]"}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-[#E7E1DA]">
          <p className="text-xs text-[#6B6560]">
            Brand: <strong className="text-[#141414]">{guidelineCollection}</strong>
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Multimodal Analysis...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Run Brand Governance Review
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
