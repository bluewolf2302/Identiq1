"use client";

import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FilePlus2,
  Images,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";

interface GuidedTourModalProps {
  isOpen: boolean;
  viewerName?: string;
  onClose: () => void;
}

interface TourStep {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  accentBg: string;
  accentBorder: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TOUR_STEPS: TourStep[] = [
  {
    number: "01",
    title: "Brand Knowledge Hub",
    subtitle: "Define your source of truth",
    description:
      "Maintain approved messaging rules, forbidden claims, visual guidelines, and brand documents that every campaign is checked against.",
    accentBg: "bg-[#E2DBFB]",
    accentBorder: "border-[#D3CAEE]",
    icon: BookOpen,
  },
  {
    number: "02",
    title: "Asset Library",
    subtitle: "Reference logos, palettes, and templates",
    description:
      "Browse approved brand logos, color swatches, and typography references used to verify visual compliance across creative submissions.",
    accentBg: "bg-[#DDF0FA]",
    accentBorder: "border-[#CBE2EF]",
    icon: Images,
  },
  {
    number: "03",
    title: "Submit a New Review",
    subtitle: "Inspect copy, images, and multi-page PDFs",
    description:
      "Upload advertisement PDFs or creatives, paste campaign copy, or load a sample brand creative to generate an evidence-backed review.",
    accentBg: "bg-[#F9DEC0]",
    accentBorder: "border-[#E8BF93]",
    icon: FilePlus2,
  },
  {
    number: "04",
    title: "Review Studio",
    subtitle: "Inspect evidence and apply guided fixes",
    description:
      "Examine highlighted copy, visual bounding regions, supported vs. conflicting vs. unverified claims, and record reviewer decisions.",
    accentBg: "bg-[#FAF0C8]",
    accentBorder: "border-[#EDE1B4]",
    icon: ScanSearch,
  },
  {
    number: "05",
    title: "Approvals & Reports",
    subtitle: "Sign off and export audit dossiers",
    description:
      "Manage pending campaigns in the Approvals queue, track team activity, and export structured compliance dossiers or CSV summaries.",
    accentBg: "bg-[#CDEEE0]",
    accentBorder: "border-[#BAE0D0]",
    icon: CheckCircle2,
  },
];

export function GuidedTourModal({
  isOpen,
  viewerName,
  onClose,
}: GuidedTourModalProps) {
  const prefersReducedMotion = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const step = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];
  const Icon = step.icon;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const modalMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, scale: 0.98, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: { duration: 0.2, ease: "easeOut" as const },
      };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <motion.div
        {...modalMotion}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-tour-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-[#E7E1DA] rounded-[28px] p-5 sm:p-7 shadow-2xl space-y-5"
      >
        {/* Top Row: Step indicator + Skip */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-[#141414] text-white flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-semibold text-[#524E4A]">
              Quick Tour · Step {stepIndex + 1} of {TOUR_STEPS.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Skip guided tour"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-[#6B6560] hover:text-[#141414] hover:bg-[#FAF8F6] transition-colors"
          >
            <span>Skip Tour</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Step Progress Dots */}
        <div className="grid grid-cols-5 gap-1.5">
          {TOUR_STEPS.map((s, idx) => (
            <button
              key={s.number}
              type="button"
              aria-label={`Jump to step ${idx + 1}: ${s.title}`}
              onClick={() => setStepIndex(idx)}
              className={`h-1.5 rounded-full transition-colors ${
                idx <= stepIndex ? "bg-[#141414]" : "bg-[#E7E1DA] hover:bg-[#CFC7BE]"
              }`}
            />
          ))}
        </div>

        {/* Active Step Card */}
        <div
          className={`${step.accentBg} border ${step.accentBorder} rounded-2xl p-5 space-y-3`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="w-10 h-10 rounded-full bg-white text-[#141414] flex items-center justify-center shadow-xs">
              <Icon className="w-5 h-5" />
            </span>
            <span className="text-xs font-mono font-bold text-[#141414]/70">
              {step.number}
            </span>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3F3B37]">
              {step.subtitle}
            </p>
            <h2
              id="guided-tour-title"
              className="font-display text-xl font-bold text-[#141414] mt-0.5"
            >
              {step.title}
            </h2>
          </div>

          <p className="text-xs sm:text-sm text-[#2B2927] leading-relaxed">
            {step.description}
          </p>
        </div>

        {isFirst && viewerName && (
          <p className="text-xs text-[#6B6560]">
            Welcome, <strong className="text-[#141414]">{viewerName}</strong>. Here is a quick walkthrough of how Identiq checks campaigns against verified brand guidelines.
          </p>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#E7E1DA] bg-white text-xs font-semibold text-[#141414] hover:bg-[#FAF8F6] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {!isLast ? (
              <button
                type="button"
                onClick={() =>
                  setStepIndex((i) => Math.min(TOUR_STEPS.length - 1, i + 1))
                }
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-xs font-semibold transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Finish Tour</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
