"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Compass,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useIdentiq } from "@/components/IdentiqProvider";
import { ViewerAvatar } from "@/components/ViewerAvatar";
import {
  AVATAR_PRESETS,
  DEFAULT_VIEWER_ROLE,
  PRESET_AVATAR_IDS,
  PresetAvatarId,
  resolveActiveActorIdentity,
  validateAvatarUpload,
  validateViewerName,
} from "@/lib/viewer-profile";

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    resetDemoWorkspace,
    user,
    viewerProfile,
    updateViewerProfile,
    replayGuidedTour,
    notify,
  } = useIdentiq();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const actor = resolveActiveActorIdentity({ viewerProfile, authUser: user });

  const [reviewerName, setReviewerName] = useState(actor.name);
  const [reviewerRole, setReviewerRole] = useState(actor.role || DEFAULT_VIEWER_ROLE);
  const [avatarId, setAvatarId] = useState<PresetAvatarId>(viewerProfile.avatarId);
  const [customAvatarDataUrl, setCustomAvatarDataUrl] = useState<string | undefined>(
    viewerProfile.customAvatarDataUrl
  );
  const [nameError, setNameError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const [autoFlagUnverified, setAutoFlagUnverified] = useState(settings.autoFlagUnverified);
  const [strictClaimsMode, setStrictClaimsMode] = useState(settings.strictClaimsMode);
  const [minimumApprovalScore, setMinimumApprovalScore] = useState(
    settings.minimumApprovalScore
  );

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Sync form state when persisted viewer profile hydrates
  useEffect(() => {
    if (viewerProfile.onboardingCompleted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReviewerName(viewerProfile.name);
      setReviewerRole(viewerProfile.role);
      setAvatarId(viewerProfile.avatarId);
      setCustomAvatarDataUrl(viewerProfile.customAvatarDataUrl);
    }
  }, [
    viewerProfile.onboardingCompleted,
    viewerProfile.name,
    viewerProfile.role,
    viewerProfile.avatarId,
    viewerProfile.customAvatarDataUrl,
  ]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError("");
    const check = validateAvatarUpload(file);
    if (!check.valid) {
      setUploadError(check.error || "Invalid image file.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomAvatarDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateViewerName(reviewerName);
    if (!check.valid) {
      setNameError(check.error || "Please enter a valid name.");
      return;
    }

    setNameError("");
    const profileRes = updateViewerProfile({
      name: check.normalized,
      role: reviewerRole,
      avatarId,
      customAvatarDataUrl: customAvatarDataUrl ?? null,
    });

    if (!profileRes.success) {
      setNameError(profileRes.error || "Could not save profile.");
      return;
    }

    updateSettings({
      reviewerName: check.normalized,
      reviewerRole: reviewerRole.trim() || DEFAULT_VIEWER_ROLE,
      autoFlagUnverified,
      strictClaimsMode,
      minimumApprovalScore,
    });
  };

  const handleConfirmReset = () => {
    setConfirmResetOpen(false);
    resetDemoWorkspace();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <div>
        <p className="text-xs font-medium text-[#6B6560] mb-1">
          Reviewer Identity, Evidence Policies &amp; Walkthrough
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#141414]">Settings</h1>
      </div>

      <form
        onSubmit={handleSave}
        noValidate
        className="bg-white border border-[#E7E1DA] rounded-[26px] p-6 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-[#EFECE7]">
          <ViewerAvatar
            name={reviewerName.trim() || actor.name}
            avatarId={avatarId}
            customAvatarDataUrl={customAvatarDataUrl}
            size="xl"
          />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#141414]">Reviewer Profile</h2>
            <p className="text-xs text-[#6B6560] mt-0.5">
              Customize how your name, role, and avatar appear on new submissions, decisions, and activity logs.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="settings-reviewer-name"
              className="block text-xs font-semibold text-[#3F3B37] mb-1.5"
            >
              Display Name <span className="text-[#7F1D1D]">*</span>
            </label>
            <input
              id="settings-reviewer-name"
              type="text"
              required
              maxLength={50}
              value={reviewerName}
              onChange={(e) => {
                setReviewerName(e.target.value);
                if (nameError) setNameError("");
              }}
              className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:bg-white focus:border-[#141414]"
            />
            {nameError && (
              <p
                role="alert"
                className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[#7F1D1D]"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{nameError}</span>
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="settings-reviewer-role"
              className="block text-xs font-semibold text-[#3F3B37] mb-1.5"
            >
              Governance Role
            </label>
            <input
              id="settings-reviewer-role"
              type="text"
              maxLength={60}
              value={reviewerRole}
              onChange={(e) => setReviewerRole(e.target.value)}
              placeholder={DEFAULT_VIEWER_ROLE}
              className="w-full px-4 py-2.5 rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] focus:outline-none focus:bg-white focus:border-[#141414]"
            />
          </div>
        </div>

        {/* Avatar Preset Selector + Custom Upload */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#3F3B37]">Avatar Appearance</span>
            <div className="flex items-center gap-2">
              {customAvatarDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomAvatarDataUrl(undefined);
                    setUploadError("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                    notify("Custom avatar removed", "info");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7F1D1D] hover:underline"
                >
                  <Trash2 className="w-3 h-3" />
                  Remove photo
                </button>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E7E1DA] bg-[#FAF8F6] hover:bg-[#F3EDE8] text-[11px] font-semibold text-[#141414] transition-colors"
              >
                <Upload className="w-3 h-3" />
                Upload Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {PRESET_AVATAR_IDS.map((id) => {
              const meta = AVATAR_PRESETS[id];
              const selected = !customAvatarDataUrl && avatarId === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={`Select ${meta.label} avatar`}
                  aria-pressed={selected}
                  onClick={() => {
                    setAvatarId(id);
                    setCustomAvatarDataUrl(undefined);
                    setUploadError("");
                  }}
                  className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-2xl border transition-all ${
                    selected
                      ? "border-[#141414] bg-[#FAF8F6] ring-1 ring-[#141414]"
                      : "border-[#E7E1DA] bg-white hover:bg-[#FAF8F6]"
                  }`}
                >
                  <ViewerAvatar
                    name={reviewerName.trim() || actor.name}
                    avatarId={id}
                    size="md"
                  />
                  <span className="text-[11px] font-medium text-[#524E4A] truncate max-w-full">
                    {meta.label}
                  </span>
                  {selected && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#141414] text-white flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {uploadError && (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs font-medium text-[#7F1D1D]"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{uploadError}</span>
            </p>
          )}
        </div>

        {/* Evidence & Approval Policies */}
        <div className="pt-4 border-t border-[#EFECE7] space-y-4">
          <h2 className="text-base font-bold text-[#141414]">Evidence &amp; Approval Policies</h2>

          <label className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Preserve Unverified vs. Conflicting Distinction
              </p>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Flag claims lacking supporting Brand Knowledge Hub evidence as unverified rather than conflicting.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoFlagUnverified}
              onChange={(e) => setAutoFlagUnverified(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#141414]"
            />
          </label>

          <label className="flex items-start justify-between gap-4 p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] cursor-pointer">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Strict Substantiated Claims Mode
              </p>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Automatically assign High Severity to absolute guarantees or prohibited terminology.
              </p>
            </div>
            <input
              type="checkbox"
              checked={strictClaimsMode}
              onChange={(e) => setStrictClaimsMode(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#141414]"
            />
          </label>

          <div className="p-4 rounded-2xl bg-[#FAF8F6] border border-[#E7E1DA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#141414]">
                Minimum Recommended Approval Score
              </p>
              <p className="text-xs text-[#6B6560]">
                Target compliance score threshold for fast-track approval.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={60}
                max={95}
                value={minimumApprovalScore}
                onChange={(e) => setMinimumApprovalScore(Number(e.target.value))}
                className="accent-[#141414]"
              />
              <span className="font-mono tabular-nums text-sm font-bold text-[#141414] w-10">
                {minimumApprovalScore}%
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            className="px-6 py-2.5 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B] transition-colors"
          >
            Save Preferences
          </button>
        </div>
      </form>

      {/* Product Walkthrough & Sample Data Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#DDF0FA]/70 border border-[#CBE2EF] rounded-[24px] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#141414]">
              <Compass className="w-4 h-4" />
              Workspace Guided Tour
            </div>
            <p className="text-xs text-[#3F3B37] leading-relaxed">
              Revisit the five-step overview of Brand Knowledge Hub, Asset Library, Creative Submission, Review Studio, and Approvals.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => replayGuidedTour()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-black/10 text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6] transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Replay Product Tour
            </button>
          </div>
        </div>

        <div className="bg-[#CDEEE0]/70 border border-[#BAE0D0] rounded-[24px] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#141414]">
              <RefreshCw className="w-4 h-4" />
              Sample Workspace Data
            </div>
            <p className="text-xs text-[#3F3B37] leading-relaxed">
              Restore the original sample reviews, brand guidelines, assets, and activity history. Your name and avatar remain unchanged.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-black/10 text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Sample Data
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Reset Sample Data */}
      {confirmResetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => setConfirmResetOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-dialog-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-[#E7E1DA] rounded-[24px] p-6 shadow-xl space-y-4"
          >
            <h2 id="reset-dialog-title" className="text-base font-bold text-[#141414]">
              Reset sample workspace data?
            </h2>
            <p className="text-xs text-[#524E4A] leading-relaxed">
              This restores the initial sample reviews, brand rules, and activity entries. Any custom reviews added during this session will be cleared, while your profile name and avatar are kept.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmResetOpen(false)}
                className="px-4 py-2 rounded-full border border-[#E7E1DA] bg-white text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-4 py-2 rounded-full bg-[#141414] text-white text-xs font-semibold hover:bg-[#2B2B2B]"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
