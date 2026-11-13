"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
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

const SAMPLE_DRAFTS = [
  {
    label: "Teralune Advertisement (Governance Test)",
    title: "Teralune Summer Refreshment Advertisement",
    contentType: "Campaign Copy" as ContentType,
    collection: "Teralune Brand Identity & AI Guidelines v1.0",
    copy: "TERALUNE® SPRING WATER | REFRESHMENT, NATURALLY. 50% OFF TODAY! The water that make you feel invincible!!! Our spring water keep you fresh and improves your immunity instantly. TERALUNE NATURAL SPRING WATER 500ml + CURES TIREDNESS + BOOSTS IMMUNITY + DETOX YOUR BODY SPECIAL PRICE ₹19 500ml BOTTLE BUY NOW!!! 100% PURE • CLINICALLY PROVEN • CARBON NEUTRAL Visit www.teralune.example for more information Refreshment, Naturally. | Limited time offer!!!",
    assetName: "teralune-test-advertisement.pdf",
  },
];

export default function NewReviewPage() {
  const router = useRouter();
  const { knowledge, addReview, settings, notify } = useIdentiq();

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType>("Campaign Copy");
  const [guidelineCollection, setGuidelineCollection] = useState(GUIDELINE_COLLECTIONS[0]);
  const [textContent, setTextContent] = useState("");
  const [assetName, setAssetName] = useState<string | undefined>(undefined);
  const [assetPreviewUrl, setAssetPreviewUrl] = useState<string | undefined>(undefined);
  const [assetBase64, setAssetBase64] = useState<string | undefined>(undefined);
  const [assetMimeType, setAssetMimeType] = useState<string | undefined>(undefined);

  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const MAX_ASSET_BASE64_CHARS = 680_000;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMessage("");
    setAssetName(file.name);
    setAssetMimeType(file.type || "application/octet-stream");

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setAssetPreviewUrl(reader.result);
          const commaIndex = reader.result.indexOf(",");
          if (commaIndex !== -1) {
            const rawBase64 = reader.result.slice(commaIndex + 1);
            setAssetBase64(
              rawBase64.length <= MAX_ASSET_BASE64_CHARS ? rawBase64 : undefined,
            );
          }
        }
      };
      reader.readAsDataURL(file);
    } else if (file.type === "text/plain" || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string" && !textContent.trim()) {
          setTextContent(reader.result.slice(0, 4000));
        }
      };
      reader.readAsText(file);
      setAssetPreviewUrl(undefined);
      setAssetBase64(undefined);
    } else {
      setAssetPreviewUrl(undefined);
      setAssetBase64(undefined);
    }
  };

  const applySampleDraft = (sample: (typeof SAMPLE_DRAFTS)[number]) => {
    setTitle(sample.title);
    setContentType(sample.contentType);
    setGuidelineCollection(sample.collection);
    setTextContent(sample.copy);
    setAssetPreviewUrl(undefined);
    setAssetName(sample.assetName);
    setAssetBase64(undefined);
    setAssetMimeType("application/pdf");
    setErrorMessage("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("Please enter a campaign or content name.");
      return;
    }
    if (textContent.trim().length < 15) {
      setErrorMessage("Please enter at least 15 characters of campaign copy or document text to review.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const submissionId = `submission-${crypto.randomUUID()}`;
      const approvedRules = knowledge
        .filter((k) => k.status === "Approved")
        .map((k) => `${k.title}: ${k.content}`);

      const res = await fetch("/api/analyze", {
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

      const responseText = await res.text();
      let data: AnalysisResponsePayload;
      try {
        data = JSON.parse(responseText) as AnalysisResponsePayload;
      } catch {
        if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
          throw new Error("Server returned an HTML error page. Please check API credentials and server logs.");
        }
        throw new Error(responseText || "Analysis request failed");
      }

      if (!res.ok) {
        throw new Error((data as unknown as { error?: string }).error || "Analysis request failed");
      }

      const themes: PastelTheme[] = ["pink", "peach", "lavender", "mint", "blue", "yellow"];
      const newId = data.submissionId ?? submissionId;

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
        textContent: textContent.trim(),
        assetUrl: assetPreviewUrl,
        assetName,
        findings: data.findings,
        pastelTheme: themes[Math.floor(Math.random() * themes.length)],
        providerUsed: data.providerUsed,
        analysisStatus: data.analysisStatus ?? "COMPLETED",
        analysisRunId: data.analysisRunId,
      };

      addReview(newReview);
      notify(`Analysis complete (${data.findings.length} findings generated)`);
      router.push(`/studio?id=${newId}`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Unable to submit content for review."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1">
            Multimodal Submission · Copy, Creative & Guidelines Check
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Submit Content for Review
          </h1>
        </div>
      </div>

      {/* Quick Sample Presets for Testing */}
      <div className="bg-[#F3EDE8] border border-[#E7E1DA] rounded-[22px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#3F3B37]">
          <Sparkles className="w-4 h-4 text-[#141414] shrink-0" />
          <span className="font-medium">Need test copy? Load a realistic brand draft:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_DRAFTS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => applySampleDraft(sample)}
              className="px-3 py-1.5 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] text-xs font-medium text-[#141414] transition-colors"
            >
              {sample.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#E7E1DA] rounded-[26px] p-6 sm:p-8 space-y-6"
      >
        {errorMessage && (
          <div className="flex items-center gap-2.5 bg-[#F6D5DA]/60 border border-[#EBC3CA] text-[#7F1D1D] px-4 py-3 rounded-2xl text-xs font-medium">
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
              placeholder="e.g., Solstice Winter Hydration Campaign"
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
              Brand / Guideline Collection
            </label>
            <select
              id="guideline-collection"
              value={guidelineCollection}
              onChange={(e) => setGuidelineCollection(e.target.value)}
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

        <div>
          <label
            htmlFor="campaign-copy"
            className="block text-xs font-semibold text-[#141414] mb-1.5"
          >
            Campaign Copy / Document Text
          </label>
          <textarea
            id="campaign-copy"
            rows={6}
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Paste ad headlines, body copy, product claims, or press release text to audit against your Brand Knowledge Hub..."
            className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] leading-relaxed placeholder:text-[#8E8780] focus:outline-none focus:bg-white focus:border-[#141414]"
          />
          <p className="text-[11px] text-[#6B6560] mt-1.5 tabular-nums">
            {textContent.length} characters · Identiq checks claims, terminology, tone, and usage policies
          </p>
        </div>

        {/* File Upload Dropzone */}
        <div>
          <span className="block text-xs font-semibold text-[#141414] mb-1.5">
            Attach Visual Creative or Supporting Document (Optional)
          </span>
          <label className="block border-2 border-dashed border-[#DED6CE] hover:border-[#141414] rounded-2xl p-6 text-center cursor-pointer bg-[#FAF8F6] transition-colors">
            <Upload className="w-6 h-6 text-[#524E4A] mx-auto mb-2" />
            <p className="text-xs font-semibold text-[#141414]">
              Upload image, PDF, or text document
            </p>
            <p className="text-[11px] text-[#6B6560] mt-1">
              Supports PNG, JPG, WEBP, PDF, TXT, MD
            </p>
            <input
              type="file"
              accept="image/*,.pdf,.txt,.md"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {assetName && (
            <div className="mt-3 flex items-center justify-between gap-3 bg-[#CDEEE0]/50 border border-[#BAE0D0] rounded-2xl px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {assetPreviewUrl ? (
                  <img
                    src={assetPreviewUrl}
                    alt={assetName}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-xl object-cover shrink-0 border border-black/10"
                  />
                ) : (
                  <span className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-[#141414]" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#141414] truncate">{assetName}</p>
                  <p className="text-[11px] text-[#14532D] inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Ready for multimodal review
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAssetName(undefined);
                  setAssetPreviewUrl(undefined);
                  setAssetBase64(undefined);
                }}
                aria-label="Remove attached file"
                className="p-1.5 rounded-lg hover:bg-black/5 text-[#3F3B37]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-[#E7E1DA]">
          <p className="text-xs text-[#6B6560]">
            Powered by Identiq Server AI Pipeline (OpenRouter primary · Gemini fallback)
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running Evidence Analysis...
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
