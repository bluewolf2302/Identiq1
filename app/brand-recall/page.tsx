
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Radar } from "lucide-react";
import type { RecallImpact } from "@/lib/recall/types";
import { detectRecallImpacts } from "@/lib/recall/impact-detector";
import {
  demoPriceChanges,
  demoReviewDependencies,
} from "@/lib/recall/demo-data";
import { useIdentiq } from "@/components/IdentiqProvider";
import {
  findReviewEvidenceForSource,
  getVersionedEvidenceSources,
  type VersionedEvidenceSource,
} from "@/lib/recall/review-evidence";

function formatPrice(amount?: number, currency?: string) {
  if (amount === undefined || !currency) {
    return "Historical price unavailable";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

function getEvidenceSourceKey(source: VersionedEvidenceSource): string {
  return JSON.stringify([source.sourceId, source.sourceType]);
}

export default function BrandRecallPage() {
  const { reviews, organisationId } = useIdentiq();
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [showDemo, setShowDemo] = useState(false);

  const evidenceSources = useMemo(
    () => getVersionedEvidenceSources(reviews),
    [reviews]
  );
  const selectedSource = evidenceSources.find(
    (source) => getEvidenceSourceKey(source) === selectedSourceKey
  );
  const matchingEvidence = useMemo(
    () =>
      selectedSource
        ? findReviewEvidenceForSource(
            reviews,
            selectedSource.sourceId,
            selectedSource.sourceType
          )
        : [],
    [reviews, selectedSource]
  );
  const demoImpacts: RecallImpact[] = useMemo(
    () =>
      showDemo
        ? detectRecallImpacts(demoPriceChanges, demoReviewDependencies)
        : [],
    [showDemo]
  );

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 text-xs font-medium text-[#6B6560]">
            Monitoring · Reviews &amp; evidence
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#141414]">
            Brand Recall Radar
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#5A5550]">
            Inspect versioned review evidence and monitor published product
            price changes without treating an evidence match as a confirmed
            price dependency.
          </p>
        </div>

        <span
          role="status"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-[#EADBA3] bg-[#FAF0C8] px-3.5 py-2 text-xs font-semibold text-[#664D03]"
        >
          <span className="h-2 w-2 rounded-full bg-[#B45309]" />
          Live integration pending
        </span>
      </header>

      <section
        aria-label="Radar status summary"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        <article className="rounded-[24px] border border-[#E7E1DA] bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-[#6B6560]">Detection engine</p>
          <p className="mt-2 text-lg font-bold text-[#141414]">
            Ready for versioned inputs
          </p>
          <p className="mt-1 text-sm text-[#6B6560]">
            The comparison logic is available; live price versions are not
            connected.
          </p>
        </article>

        <article className="rounded-[24px] border border-[#E7E1DA] bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-[#6B6560]">Evidence coverage</p>
          <p className="mt-2 text-lg font-bold text-[#141414]">
            {evidenceSources.length > 0
              ? "Versioned references available"
              : "Not present in loaded reviews"}
          </p>
          <p className="mt-1 text-sm text-[#6B6560]">
            This reflects loaded finding evidence only, not complete price
            dependency coverage.
          </p>
        </article>

        <article className="rounded-[24px] border border-[#E7E1DA] bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-[#6B6560]">Live integration</p>
          <p className="mt-2 text-lg font-bold text-[#664D03]">
            Phase 3 pending
          </p>
          <p className="mt-1 text-sm text-[#6B6560]">
            Published price history and review-level dependencies are not
            available to this page.
          </p>
        </article>
      </section>

      <section className="space-y-4 rounded-[24px] border border-[#E7E1DA] bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-[#141414]">
            Affected reviews
          </h2>
          <p className="mt-1 text-sm text-[#6B6560]">
            Only verified structured price dependencies can support a real
            recall impact.
          </p>
        </div>

        <div
          role="status"
          className="rounded-2xl border border-dashed border-[#D3CCC4] bg-[#FAF8F6] px-5 py-10 text-center"
        >
          <Radar className="mx-auto mb-3 h-8 w-8 text-[#6B6560]" />
          <h3 className="font-semibold text-[#141414]">
            Live impact feed is not connected
          </h3>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-[#6B6560]">
            Published product-price history and review-level dependencies are
            unavailable. The number of affected reviews is unknown, not zero.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-[24px] border border-[#E7E1DA] bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-xl font-bold text-[#141414]">
            Evidence explorer
          </h2>
          <p className="mt-1 text-sm text-[#6B6560]">
            Browse generic versioned evidence references from currently loaded
            reviews. These references do not establish a product-price
            dependency or confirm a price change.
          </p>
        </div>

        <p className="rounded-xl bg-[#FAF8F6] px-4 py-3 text-xs text-[#524E4A]">
          Scope: {organisationId ? "loaded organisation reviews" : "current workspace"}.
          Evidence is not filtered or verified by active brand.
        </p>

        {evidenceSources.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D3CCC4] px-5 py-8 text-center">
            <p className="font-semibold text-[#141414]">
              No versioned evidence is available in loaded reviews
            </p>
            <p className="mt-2 text-sm text-[#6B6560]">
              This describes the currently loaded review data only; it does not
              establish that no price dependencies exist.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-w-2xl">
              <label
                htmlFor="evidence-source"
                className="mb-1.5 block text-xs font-semibold text-[#3F3B37]"
              >
                Versioned evidence source
              </label>
              <select
                id="evidence-source"
                value={selectedSourceKey}
                onChange={(event) => setSelectedSourceKey(event.target.value)}
                className="w-full rounded-xl border border-[#E7E1DA] bg-[#FAF8F6] px-3.5 py-2.5 text-sm text-[#141414] focus:outline-none focus:border-[#141414]"
              >
                <option value="">Select a source to inspect</option>
                {evidenceSources.map((source) => (
                  <option
                    key={getEvidenceSourceKey(source)}
                    value={getEvidenceSourceKey(source)}
                  >
                    {source.sourceTitle} · {source.sourceType} · {source.sourceId}
                  </option>
                ))}
              </select>
            </div>

            {selectedSource ? (
              matchingEvidence.length > 0 ? (
                <div className="space-y-3">
                  {matchingEvidence.map((match) => {
                    const encodedReviewId = encodeURIComponent(match.reviewId);

                    return (
                      <article
                        key={JSON.stringify([
                          match.reviewId,
                          match.analysisRunId,
                          match.sourceId,
                          match.sourceType,
                          match.versionId,
                        ])}
                        className="rounded-2xl border border-[#E7E1DA] bg-white p-4"
                      >
                        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                          <div>
                            <h3 className="font-semibold text-[#141414]">
                              {match.reviewTitle}
                            </h3>
                            <p className="mt-1 text-xs text-[#6B6560]">
                              Review ID: {match.reviewId}
                            </p>
                          </div>
                          <span className="w-fit rounded-full border border-[#CBE2EF] bg-[#DDF0FA] px-3 py-1 text-[11px] font-semibold text-[#0C4A6E]">
                            Generic evidence · not a price dependency
                          </span>
                        </div>

                        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                          <div>
                            <dt className="text-[#6B6560]">Source ID</dt>
                            <dd className="break-all font-medium text-[#141414]">
                              {match.sourceId}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[#6B6560]">Source type</dt>
                            <dd className="break-all font-medium text-[#141414]">
                              {match.sourceType}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[#6B6560]">Evidence version</dt>
                            <dd className="break-all font-medium text-[#141414]">
                              {match.versionId}
                            </dd>
                          </div>
                        </dl>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            href={`/reports?tab=review&reviewId=${encodedReviewId}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#E7E1DA] bg-white px-3.5 py-2 text-xs font-semibold text-[#141414] transition-colors hover:bg-[#FAF8F6]"
                          >
                            Open dossier
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                          <Link
                            href={`/studio?id=${encodedReviewId}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#141414] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#2B2B2B]"
                          >
                            Open in Review Studio
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-[#FAF8F6] px-4 py-3 text-sm text-[#6B6560]">
                  No matching references remain in the currently loaded
                  reviews.
                </p>
              )
            ) : (
              <p className="text-sm text-[#6B6560]">
                Select a source to see its versioned references and associated
                reviews.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-[24px] border border-[#EADBA3] bg-[#FAF0C8]/30 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#664D03]">
              Demonstration · fictional data
            </p>
            <h2 className="mt-1 text-xl font-bold text-[#141414]">
              Sample recall alert
            </h2>
            <p className="mt-1 text-sm text-[#524E4A]">
              This isolated example never represents a real review, price
              change, or approval decision.
            </p>
          </div>
          <span className="w-fit rounded-full border border-[#EADBA3] bg-[#FAF0C8] px-3 py-1 text-xs font-semibold text-[#664D03]">
            Opt-in demo
          </span>
        </div>

        <label
          htmlFor="show-recall-demo"
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#E7E1DA] bg-white px-4 py-3 text-sm font-medium text-[#141414]"
        >
          <input
            id="show-recall-demo"
            type="checkbox"
            checked={showDemo}
            onChange={(event) => setShowDemo(event.target.checked)}
            className="h-4 w-4 accent-[#141414]"
          />
          Show fictional alert
        </label>

        {showDemo && (
          <div className="space-y-3" aria-live="polite">
            {demoImpacts.map((impact) => (
              <article
                key={impact.alertKey}
                className="rounded-2xl border border-[#EADBA3] bg-white p-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-[#141414]">
                    Review: {impact.reviewId}
                  </h3>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF0C8] px-3 py-1 text-xs font-semibold text-[#664D03]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Needs reassessment
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-[#524E4A]">
                    Original price:{" "}
                    {formatPrice(impact.usedAmountMinor, impact.usedCurrency)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#8C827A]" />
                  <span className="font-semibold text-[#141414]">
                    New price:{" "}
                    {formatPrice(impact.newAmountMinor, impact.newCurrency)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
