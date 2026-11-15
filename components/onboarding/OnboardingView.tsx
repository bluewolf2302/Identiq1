"use client";

import React, { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AVATAR_PRESETS,
  DEFAULT_VIEWER_ROLE,
  PRESET_AVATAR_IDS,
  PresetAvatarId,
  validateAvatarUpload,
  validateViewerName,
} from "@/lib/viewer-profile";
import { ViewerAvatar } from "@/components/ViewerAvatar";

interface OnboardingViewProps {
  onBack: () => void;
  onComplete: (input: {
    name: string;
    role?: string;
    avatarId: PresetAvatarId;
    customAvatarDataUrl?: string;
    startTour?: boolean;
  }) => { success: boolean; error?: string };
}

export function OnboardingView({ onBack, onComplete }: OnboardingViewProps) {
  const prefersReducedMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState(DEFAULT_VIEWER_ROLE);
  const [avatarId, setAvatarId] = useState<PresetAvatarId>("obsidian");
  const [customAvatarDataUrl, setCustomAvatarDataUrl] = useState<string | undefined>(
    undefined
  );
  const [nameError, setNameError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateViewerName(name);
    if (!check.valid) {
      setNameError(check.error || "Please enter your name.");
      return;
    }

    setNameError("");
    const result = onComplete({
      name: check.normalized,
      role,
      avatarId,
      customAvatarDataUrl,
      startTour: true,
    });

    if (!result.success) {
      setNameError(result.error || "Please enter your name.");
    }
  };

  const cardMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F6] text-[#141414]">
      {/* Minimal Header */}
      <header className="w-full max-w-[960px] mx-auto px-5 sm:px-8 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-[#141414] text-white flex items-center justify-center shadow-xs">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">Identiq</span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-[#524E4A] hover:text-[#141414] hover:bg-[#F3EDE8] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
      </header>

      {/* Centered Single-Card Setup */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-6 sm:py-10">
        <motion.div
          {...cardMotion}
          className="w-full max-w-lg bg-white border border-[#E7E1DA] rounded-[28px] p-6 sm:p-8 shadow-sm space-y-6"
        >
          {/* Live Profile Preview + Heading */}
          <div className="flex items-center gap-4">
            <ViewerAvatar
              name={name.trim() || "IQ"}
              avatarId={avatarId}
              customAvatarDataUrl={customAvatarDataUrl}
              size="xl"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6560]">
                Workspace Setup
              </p>
              <h1 className="font-display text-2xl font-bold tracking-tight text-[#141414]">
                Set up your reviewer profile
              </h1>
              <p className="text-xs text-[#6B6560] mt-0.5">
                Your name and avatar will appear across reviews, decisions, and activity logs.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Required Name */}
            <div>
              <label
                htmlFor="onboarding-name"
                className="block text-xs font-semibold text-[#141414] mb-1.5"
              >
                Your Name <span className="text-[#7F1D1D]">*</span>
              </label>
              <input
                id="onboarding-name"
                type="text"
                required
                autoFocus
                maxLength={50}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError("");
                }}
                placeholder="Enter your full name"
                aria-invalid={Boolean(nameError)}
                className="w-full px-4 py-3 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:bg-white focus:border-[#141414]"
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

            {/* Optional Role */}
            <div>
              <label
                htmlFor="onboarding-role"
                className="block text-xs font-semibold text-[#141414] mb-1.5"
              >
                Role or Title <span className="text-[#6B6560] font-normal">(optional)</span>
              </label>
              <input
                id="onboarding-role"
                type="text"
                maxLength={60}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g., Brand Governance Lead"
                className="w-full px-4 py-2.5 rounded-2xl border border-[#E7E1DA] bg-[#FAF8F6] text-sm text-[#141414] placeholder:text-[#8E8780] focus:outline-none focus:bg-white focus:border-[#141414]"
              />
            </div>

            {/* Avatar Presets + Optional Custom Upload */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#141414]">
                  Choose an Avatar
                </span>
                <div className="flex items-center gap-2">
                  {customAvatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomAvatarDataUrl(undefined);
                        setUploadError("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
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
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-6 gap-2.5">
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
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-2xl border transition-all ${
                        selected
                          ? "border-[#141414] bg-[#FAF8F6] ring-1 ring-[#141414]"
                          : "border-[#E7E1DA] bg-white hover:bg-[#FAF8F6]"
                      }`}
                    >
                      <ViewerAvatar name={name.trim() || "IQ"} avatarId={id} size="md" />
                      <span className="text-[10px] font-medium text-[#524E4A] truncate max-w-full">
                        {meta.label.split(" ")[0]}
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

              <p className="text-[11px] text-[#6B6560]">
                Pick a geometric style or optionally upload a PNG, JPG, or WEBP photo (up to 512 KB).
              </p>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-sm font-semibold transition-colors shadow-xs"
            >
              <span>Enter Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </motion.div>
      </main>
    </div>
  );
}
