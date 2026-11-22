"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileCheck2,
  HelpCircle,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

interface LandingViewProps {
  onGetStarted: () => void;
}

export function LandingView({ onGetStarted }: LandingViewProps) {
  const prefersReducedMotion = useReducedMotion();

  const heroMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, ease: "easeOut" as const },
      };

  const visualMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.48, delay: 0.08, ease: "easeOut" as const },
      };

  const bentoMotion = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, delay: 0.16, ease: "easeOut" as const },
      };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F6] text-[#141414]">
      {/* Minimal Single-Identity Header */}
      <header className="w-full max-w-[1200px] mx-auto px-5 sm:px-8 pt-6 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-[#141414] text-white flex items-center justify-center shadow-xs">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-[#141414]">
            Identiq
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium text-[#6B6560]">
          <span className="hidden sm:inline">Brand Governance Platform</span>
          <a
            href="/login"
            className="font-semibold text-[#141414] hover:underline focus:outline-none focus:ring-2 focus:ring-[#141414] rounded-md px-1 py-0.5"
          >
            Sign In
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-5 sm:px-8 py-6 sm:py-10 flex flex-col justify-center gap-12 sm:gap-14">
        {/* Hero Split Section */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <motion.div {...heroMotion} className="lg:col-span-6 space-y-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#6B6560]">
              Evidence-Driven Creative Review
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-[1.08] text-[#141414] text-balance">
              Review every campaign against verified brand evidence.
            </h1>
            <p className="text-sm sm:text-base text-[#524E4A] leading-relaxed max-w-xl">
              Check campaign copy, visual layouts, palettes, and claims against your approved brand rules. Every finding distinguishes supported usage, direct conflicts, and unverified claims before sign-off.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onGetStarted}
                className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-full bg-[#141414] text-white hover:bg-[#2B2B2B] text-sm font-semibold transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#141414] focus:ring-offset-2 focus:ring-offset-[#FAF8F6]"
              >
                <span>Enter IdentIQ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>

          {/* Bespoke Editorial Vector Governance Composition (Zero Stock Photos) */}
          <motion.div {...visualMotion} className="lg:col-span-6">
            <div className="relative bg-[#F3EDE8] border border-[#E7E1DA] rounded-[28px] p-5 sm:p-7 overflow-hidden">
              {/* Subtle geometric backdrop SVG */}
              <svg
                viewBox="0 0 480 340"
                aria-hidden="true"
                className="absolute inset-0 w-full h-full pointer-events-none opacity-65"
              >
                <circle cx="420" cy="48" r="76" fill="#CDEEE0" />
                <circle cx="56" cy="296" r="68" fill="#E2DBFB" />
                <rect x="290" y="210" width="140" height="90" rx="22" fill="#F9DEC0" opacity="0.7" />
              </svg>

              {/* Editorial Campaign Proof Card */}
              <div className="relative z-10 bg-white border border-[#E7E1DA] rounded-[22px] p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#EFECE7]">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#6B6560]">
                      Campaign Creative Inspection
                    </p>
                    <p className="text-sm font-bold text-[#141414] truncate">
                      Summer Botanical Launch Poster
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-[#CDEEE0] text-[#14532D] text-xs font-bold tabular-nums shrink-0">
                    91% Ready
                  </span>
                </div>

                {/* Vector Creative Wireframe Preview + Palette Swatches */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch">
                  <div className="sm:col-span-5 bg-[#FAF8F6] border border-[#E7E1DA] rounded-xl p-3 flex flex-col justify-between gap-3">
                    <svg viewBox="0 0 180 118" aria-hidden="true" className="w-full h-auto">
                      <rect x="0" y="0" width="180" height="118" rx="10" fill="#F3EDE8" />
                      <rect x="14" y="14" width="44" height="12" rx="4" fill="#141414" />
                      <rect x="14" y="34" width="112" height="10" rx="3" fill="#3F3B37" opacity="0.85" />
                      <rect x="14" y="50" width="84" height="8" rx="3" fill="#6B6560" opacity="0.55" />
                      <circle cx="138" cy="76" r="24" fill="#CDEEE0" stroke="#14532D" strokeWidth="1.5" />
                      <rect x="14" y="84" width="64" height="20" rx="10" fill="#141414" />
                    </svg>
                    <div className="flex items-center justify-between text-[10px] text-[#524E4A]">
                      <span>Brand Palette</span>
                      <div className="flex items-center gap-1">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#141414] border border-black/10" />
                        <span className="w-3.5 h-3.5 rounded-full bg-[#CDEEE0] border border-black/10" />
                        <span className="w-3.5 h-3.5 rounded-full bg-[#F9DEC0] border border-black/10" />
                      </div>
                    </div>
                  </div>

                  {/* Three Evidence Distinctions */}
                  <div className="sm:col-span-7 space-y-2">
                    <div className="rounded-xl bg-[#CDEEE0]/55 border border-[#BAE0D0] px-3 py-2 flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#14532D] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#141414]">Supported</p>
                        <p className="text-[11px] text-[#3F5E50] leading-snug">
                          Primary typography and approved palette match Brand Guide §2.1.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#F6D5DA]/55 border border-[#EBC3CA] px-3 py-2 flex items-start gap-2.5">
                      <ShieldAlert className="w-4 h-4 text-[#7F1D1D] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#141414]">Conflicting</p>
                        <p className="text-[11px] text-[#7F1D1D] leading-snug">
                          Absolute guarantee phrase prohibited under Brand Claims §4.3.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#FAF0C8]/65 border border-[#EDE1B4] px-3 py-2 flex items-start gap-2.5">
                      <HelpCircle className="w-4 h-4 text-[#78350F] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#141414]">Unverified</p>
                        <p className="text-[11px] text-[#5E5225] leading-snug">
                          Sourcing figure flagged for human verification — never guessed false.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Compact Editorial 3-Card Bento */}
        <motion.section {...bentoMotion} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-semibold text-[#6B6560]">01</span>
              <span className="w-8 h-8 rounded-full bg-[#E2DBFB] flex items-center justify-center text-[#141414]">
                <BookOpen className="w-4 h-4" />
              </span>
            </div>
            <h2 className="text-sm font-bold text-[#141414]">Verified Brand Knowledge</h2>
            <p className="text-xs text-[#524E4A] leading-relaxed">
              Centralize approved messaging, forbidden claims, colour palettes, and reference assets in one governed hub.
            </p>
          </div>

          <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-semibold text-[#6B6560]">02</span>
              <span className="w-8 h-8 rounded-full bg-[#DDF0FA] flex items-center justify-center text-[#141414]">
                <ScanSearch className="w-4 h-4" />
              </span>
            </div>
            <h2 className="text-sm font-bold text-[#141414]">Visual &amp; Copy Inspection</h2>
            <p className="text-xs text-[#524E4A] leading-relaxed">
              Upload campaign PDFs, images, or draft copy to inspect extracted text, visual rules, and pinned creative regions.
            </p>
          </div>

          <div className="bg-white border border-[#E7E1DA] rounded-[22px] p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-semibold text-[#6B6560]">03</span>
              <span className="w-8 h-8 rounded-full bg-[#CDEEE0] flex items-center justify-center text-[#141414]">
                <FileCheck2 className="w-4 h-4" />
              </span>
            </div>
            <h2 className="text-sm font-bold text-[#141414]">Traceable Sign-Off</h2>
            <p className="text-xs text-[#524E4A] leading-relaxed">
              Record reviewer decisions, resolve findings with guided edits, and export compliance dossiers for release sign-off.
            </p>
          </div>
        </motion.section>
      </main>

      {/* Quiet Footer */}
      <footer className="w-full max-w-[1200px] mx-auto px-5 sm:px-8 py-5 border-t border-[#E7E1DA]/80 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#6B6560]">
        <span>Identiq · Brand Governance &amp; Compliance Review</span>
        <span>Built for transparent, evidence-backed creative approvals</span>
      </footer>
    </div>
  );
}
