"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  FileImage,
  HardDrive,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { PASTEL_SURFACE } from "@/components/ThemeTokens";
import { AssetCategory, BrandAsset, PastelTheme } from "@/lib/types";
import {
  formatAssetBytes,
  getAssetPersistenceNotice,
  MAX_ASSET_FILE_SIZE_BYTES,
  validateAssetSubmission,
  validateAssetUploadFile,
} from "@/lib/asset-validation";

const CATEGORIES: Array<"All" | AssetCategory> = [
  "All",
  "Logos",
  "Brand Images",
  "Marketing Assets",
  "Icons & Marks",
];

export default function AssetLibraryPage() {
  const { assets, addAsset, deleteAsset, notify, hydrated, persistenceMode, selectedBrandId } =
    useIdentiq();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<"All" | AssetCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewAsset, setPreviewAsset] = useState<BrandAsset | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Upload state
  const [assetName, setAssetName] = useState("");
  const [assetCategory, setAssetCategory] = useState<AssetCategory>("Brand Images");
  const [assetNote, setAssetNote] = useState("");
  const [assetPreviewData, setAssetPreviewData] = useState<string | undefined>(undefined);
  const [assetFormat, setAssetFormat] = useState("PNG");
  const [assetSizeBytes, setAssetSizeBytes] = useState<number | undefined>(undefined);
  const [fileValidationError, setFileValidationError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const persistenceNotice = getAssetPersistenceNotice(persistenceMode);

  const closeUploadModal = () => {
    setUploadOpen(false);
    setAssetName("");
    setAssetCategory("Brand Images");
    setAssetNote("");
    setAssetPreviewData(undefined);
    setAssetFormat("PNG");
    setAssetSizeBytes(undefined);
    setFileValidationError("");
    setUploadError("");
    setSubmitting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!previewAsset && !uploadOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (uploadOpen) {
        setUploadOpen(false);
        setAssetName("");
        setAssetCategory("Brand Images");
        setAssetNote("");
        setAssetPreviewData(undefined);
        setAssetFormat("PNG");
        setAssetSizeBytes(undefined);
        setFileValidationError("");
        setUploadError("");
        setSubmitting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else if (previewAsset) {
        setPreviewAsset(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewAsset, uploadOpen]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const catMatch = selectedCategory === "All" || asset.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const searchMatch =
        !q ||
        asset.name.toLowerCase().includes(q) ||
        asset.usageNote.toLowerCase().includes(q) ||
        asset.format.toLowerCase().includes(q);
      return catMatch && searchMatch;
    });
  }, [assets, selectedCategory, searchQuery]);

  const hasActiveFilter = selectedCategory !== "All" || searchQuery.trim().length > 0;

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    setFileValidationError("");

    const validation = validateAssetUploadFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!validation.valid) {
      const message = validation.error || "Invalid asset file selected.";
      setFileValidationError(message);
      setUploadError(message);
      setAssetPreviewData(undefined);
      setAssetSizeBytes(undefined);
      e.target.value = "";
      return;
    }

    if (!assetName.trim()) {
      setAssetName(file.name.replace(/\.[^/.]+$/, ""));
    }
    setAssetFormat(validation.format || "IMAGE");
    setAssetSizeBytes(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAssetPreviewData(reader.result);
      }
    };
    reader.onerror = () => {
      const readErr = "Unable to read the selected file in this browser.";
      setFileValidationError(readErr);
      setUploadError(readErr);
      setAssetPreviewData(undefined);
      setAssetSizeBytes(undefined);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const submissionCheck = validateAssetSubmission({
      name: assetName,
      hasFileOrPreview: Boolean(assetPreviewData),
      pendingFileError: fileValidationError || undefined,
    });

    if (!submissionCheck.valid) {
      setUploadError(submissionCheck.error || "Please complete required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const tones: PastelTheme[] = ["pink", "peach", "lavender", "mint", "blue", "yellow"];
      const nextAsset: BrandAsset = {
        id: `ast-${Date.now()}`,
        name: submissionCheck.normalizedName!,
        category: assetCategory,
        format: assetFormat,
        dimensions: assetSizeBytes ? `${formatAssetBytes(assetSizeBytes)} Upload` : "Custom Upload",
        status: "Approved",
        previewUrl: assetPreviewData,
        colorTone: tones[assets.length % tones.length],
        usageNote:
          assetNote.trim() ||
          "Uploaded to Identiq Asset Library. Maintain minimum 20px safe margin.",
        updatedAt: new Date().toISOString().split("T")[0],
      };

      addAsset(nextAsset);
      closeUploadModal();
    } catch (err) {
      setSubmitting(false);
      setUploadError(err instanceof Error ? err.message : "Failed to save asset.");
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#6B6560] mb-1 tabular-nums">
            {hydrated
              ? `${assets.length} visual ${assets.length === 1 ? "resource" : "resources"} · Approved logos, photography, and marks`
              : "Loading visual resources..."}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Asset Library
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setUploadError("");
            setFileValidationError("");
            setUploadOpen(true);
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#141414]"
        >
          <Plus className="w-4 h-4" />
          Upload Asset
        </button>
      </div>

      {/* Honest Storage Scope Banner */}
      <div
        className={`rounded-[22px] border px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          persistenceNotice.scope === "session_only"
            ? "bg-[#FFF4E5]/70 border-[#FFE2BA] text-[#78350F]"
            : "bg-[#F3EDE8]/80 border-[#E7E1DA] text-[#3F3B37]"
        }`}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#141414]">
              {persistenceNotice.label}
            </p>
            <p className="text-[11px] leading-relaxed mt-0.5">
              {persistenceNotice.description}
            </p>
          </div>
        </div>
        <Link
          href={selectedBrandId ? `/knowledge-hub?brandId=${encodeURIComponent(selectedBrandId)}` : "/knowledge-hub"}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-[#E7E1DA] hover:border-[#141414] text-[11px] font-semibold text-[#141414] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Synced Brand Rules
        </Link>
      </div>

      {/* Category Filter + Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141414] ${
                  active
                    ? "bg-[#141414] text-white border-[#141414]"
                    : "bg-white text-[#3F3B37] border-[#E7E1DA] hover:bg-[#F3EDE8]"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="relative w-full md:w-64 shrink-0">
          <Search className="w-4 h-4 text-[#6B6560] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search brand assets"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search brand assets..."
            className="w-full pl-9 pr-3 py-2 rounded-full bg-white border border-[#E7E1DA] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
          />
        </div>
      </div>

      {/* Asset Cards Grid */}
      {!hydrated ? (
        <div
          aria-label="Loading brand assets"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white border border-[#E7E1DA] rounded-[24px] overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-[#F3EDE8]" />
              <div className="p-4 space-y-2.5">
                <div className="h-3 w-28 rounded-full bg-[#EFE9E2]" />
                <div className="h-4 w-44 rounded-full bg-[#E7E1DA]" />
                <div className="h-3 w-full rounded-full bg-[#F3EDE8]" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-10 text-center space-y-3">
          <FileImage className="w-8 h-8 text-[#8E8780] mx-auto" />
          <p className="text-sm font-semibold text-[#141414]">
            {assets.length === 0 ? "No brand assets in library yet" : "No matching brand assets"}
          </p>
          <p className="text-xs text-[#6B6560] max-w-md mx-auto">
            {assets.length === 0
              ? "Upload approved brand logos, photography, or marks to reference alongside campaign reviews."
              : "No uploaded or seeded assets match the current category and search filters."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#E7E1DA] bg-white hover:bg-[#FAF8F6] text-xs font-semibold text-[#141414]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear Filters
              </button>
            )}
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              {assets.length === 0 ? "Upload First Asset" : "Upload Asset"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAssets.map((asset) => {
            const tone = PASTEL_SURFACE[asset.colorTone];
            const isApproved = asset.status === "Approved";
            return (
              <div
                key={asset.id}
                className="bg-white border border-[#E7E1DA] rounded-[24px] overflow-hidden flex flex-col justify-between"
              >
                <div>
                  {/* Asset Visual Frame */}
                  <button
                    type="button"
                    onClick={() => setPreviewAsset(asset)}
                    className={`w-full aspect-[4/3] ${tone.bg} relative flex items-center justify-center overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#141414]`}
                  >
                    {asset.previewUrl ? (
                      <img
                        src={asset.previewUrl}
                        alt={asset.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 px-6 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center shadow-xs">
                          <ShieldCheck className="w-7 h-7 text-[#141414]" />
                        </div>
                        <span className="text-xs font-bold text-[#141414] tracking-tight">
                          {asset.name}
                        </span>
                      </div>
                    )}
                    <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-white/90 text-[11px] font-semibold text-[#141414] inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Eye className="w-3 h-3" />
                      Preview
                    </span>
                  </button>

                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="text-[#6B6560]">
                        {asset.category} · {asset.format}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          isApproved ? "text-[#166534]" : "text-[#92400E]"
                        }`}
                      >
                        {isApproved ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        {asset.status}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-[#141414] mb-1.5">{asset.name}</h3>
                    <p className="text-xs text-[#524E4A] leading-relaxed line-clamp-2">
                      {asset.usageNote}
                    </p>
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-[#F0ECE7] flex items-center justify-between text-xs text-[#6B6560]">
                  <span className="font-mono tabular-nums">{asset.dimensions}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewAsset(asset)}
                      className="text-xs font-semibold text-[#141414] hover:underline"
                    >
                      Inspect
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAsset(asset.id)}
                      aria-label={`Remove ${asset.name}`}
                      className="text-[#991B1B] hover:opacity-75 p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141414]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Asset Preview Modal */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewAsset(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-preview-title"
            className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-xl w-full overflow-hidden shadow-xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7E1DA]">
              <div>
                <p className="text-xs text-[#6B6560]">
                  {previewAsset.category} · {previewAsset.format} · {previewAsset.dimensions}
                </p>
                <h2 id="asset-preview-title" className="text-base font-bold text-[#141414]">
                  {previewAsset.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                aria-label="Close preview"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#FAF8F6] p-6 flex items-center justify-center">
              {previewAsset.previewUrl ? (
                <img
                  src={previewAsset.previewUrl}
                  alt={previewAsset.name}
                  referrerPolicy="no-referrer"
                  className="max-h-72 rounded-2xl object-contain"
                />
              ) : (
                <div className="w-full h-56 rounded-2xl bg-[#E2DBFB] flex flex-col items-center justify-center gap-2">
                  <ShieldCheck className="w-10 h-10 text-[#141414]" />
                  <p className="text-sm font-bold text-[#141414]">{previewAsset.name}</p>
                </div>
              )}
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#6B6560] mb-1">Approved Usage Guidance</p>
                <p className="text-sm text-[#141414] leading-relaxed">{previewAsset.usageNote}</p>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-[#6B6560] tabular-nums">
                  Updated {previewAsset.updatedAt}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard) {
                      void navigator.clipboard.writeText(previewAsset.name);
                      notify("Asset reference copied to clipboard");
                    } else {
                      notify(`Asset reference: ${previewAsset.name}`, "info");
                    }
                  }}
                  className="px-4 py-2 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] text-xs font-semibold"
                >
                  Copy Asset Reference
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Asset Modal */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-asset-title"
            className="bg-white border border-[#E7E1DA] rounded-[26px] max-w-lg w-full p-6 shadow-xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 id="upload-asset-title" className="text-lg font-bold text-[#141414]">
                  Upload Brand Asset
                </h2>
                <p className="text-[11px] text-[#6B6560] mt-0.5">
                  {persistenceNotice.label}
                </p>
              </div>
              <button
                type="button"
                onClick={closeUploadModal}
                aria-label="Close upload modal"
                className="p-1.5 rounded-lg hover:bg-[#FAF8F6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {uploadError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs text-[#7F1D1D] bg-[#F6D5DA]/60 border border-[#EBC3CA] px-3 py-2.5 rounded-xl font-medium"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}

              <label className="block border-2 border-dashed border-[#DED6CE] hover:border-[#141414] rounded-2xl p-6 text-center cursor-pointer bg-[#FAF8F6] transition-colors">
                <Upload className="w-6 h-6 text-[#524E4A] mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#141414]">
                  Select an image, logo SVG, or marketing creative
                </p>
                <p className="text-[11px] text-[#6B6560] mt-1 tabular-nums">
                  PNG, JPG, WEBP, SVG supported · Max {formatAssetBytes(MAX_ASSET_FILE_SIZE_BYTES)}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleFilePick}
                  disabled={submitting}
                  className="hidden"
                />
                {assetPreviewData && (
                  <div className="mt-4 space-y-1.5">
                    <img
                      src={assetPreviewData}
                      alt="Selected asset preview"
                      className="max-h-32 mx-auto rounded-xl object-contain"
                    />
                    {assetSizeBytes !== undefined && (
                      <p className="text-[11px] font-medium text-[#14532D] tabular-nums">
                        {assetFormat} · {formatAssetBytes(assetSizeBytes)} ready
                      </p>
                    )}
                  </div>
                )}
              </label>

              <div>
                <label
                  htmlFor="asset-title-input"
                  className="block text-xs font-semibold text-[#3F3B37] mb-1"
                >
                  Asset Title
                </label>
                <input
                  id="asset-title-input"
                  type="text"
                  value={assetName}
                  onChange={(e) => {
                    setAssetName(e.target.value);
                    if (uploadError && !fileValidationError) setUploadError("");
                  }}
                  disabled={submitting}
                  placeholder="e.g., Holiday Campaign Primary Banner"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>

              <div>
                <label
                  htmlFor="asset-category-select"
                  className="block text-xs font-semibold text-[#3F3B37] mb-1"
                >
                  Category
                </label>
                <select
                  id="asset-category-select"
                  value={assetCategory}
                  onChange={(e) => setAssetCategory(e.target.value as AssetCategory)}
                  disabled={submitting}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                >
                  <option value="Logos">Logos</option>
                  <option value="Brand Images">Brand Images</option>
                  <option value="Marketing Assets">Marketing Assets</option>
                  <option value="Icons & Marks">Icons & Marks</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="asset-note-input"
                  className="block text-xs font-semibold text-[#3F3B37] mb-1"
                >
                  Usage Policy Note
                </label>
                <textarea
                  id="asset-note-input"
                  rows={2}
                  value={assetNote}
                  onChange={(e) => setAssetNote(e.target.value)}
                  disabled={submitting}
                  placeholder="Clearspace, channel restrictions, or approved crop instructions..."
                  className="w-full px-3.5 py-2 rounded-xl border border-[#E7E1DA] text-xs text-[#141414] focus:outline-none focus:border-[#141414]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={closeUploadModal}
                  disabled={submitting}
                  className="px-4 py-2 rounded-full border border-[#E7E1DA] text-xs font-semibold text-[#3F3B37] hover:bg-[#FAF8F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-full bg-[#141414] text-white hover:bg-[#2A2A2A] disabled:opacity-60 text-xs font-semibold"
                >
                  {submitting ? "Saving..." : "Save to Library"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

