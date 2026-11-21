
"use client";
import { useState } from "react";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Radar, AlertTriangle } from "lucide-react";
import type { RecallImpact } from "@/lib/recall/types";
import { detectRecallImpacts } from "@/lib/recall/impact-detector";
import {
  demoPriceChanges,
  demoReviewDependencies,
} from "@/lib/recall/demo-data";
import { useIdentiq } from "@/components/IdentiqProvider";
import { findReviewEvidenceForSource } from "@/lib/recall/review-evidence";

function formatPrice(amount?: number, currency?: string) {
  if (amount === undefined || !currency) {
    return "Historical price unavailable";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  }).format(amount / 100);
}
export default function BrandRecallPage() {
  const { reviews } = useIdentiq();
  const [sourceId, setSourceId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [showDemo, setShowDemo] = useState(false);

const impacts: RecallImpact[] = showDemo
  ? detectRecallImpacts(
      demoPriceChanges,
      demoReviewDependencies
    )
  : [];
  const matchingEvidence = findReviewEvidenceForSource(
    reviews,
    sourceId,
    sourceType
  );
  const exampleReference = reviews
  .flatMap((review) => review.findings)
  .flatMap((finding) => finding.evidenceReferences ?? [])
  .find((reference) => Boolean(reference.versionId));

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/reports"
          className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft size={16} />
          Back to Reports
        </Link>

        <div className="mb-8 flex items-center gap-4">
          <div className="rounded-2xl bg-indigo-100 p-4 text-indigo-700">
            <Radar size={28} />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Brand Recall Radar
            </h1>
            <p className="mt-1 text-slate-600">
              Identify reviews affected by published product price changes.
            </p>
          </div>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Detection engine
            </p>
            <p className="mt-2 text-xl font-semibold text-emerald-700">
              Ready
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Price-version impact detection implemented.
            </p>
            <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">
  {exampleReference
    ? `Saved evidence: ${exampleReference.sourceId} | Type: ${exampleReference.sourceType} | Version: ${exampleReference.versionId}`
    : "No versioned evidence references found in currently loaded reviews."}
</p>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">
              Live data connection
            </p>
            <p className="mt-2 text-xl font-semibold text-amber-700">
              Pending
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Review and price sources will be connected in Phase D.
            </p>
          </div>
        </div>

<div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
  <label className="flex cursor-pointer items-center gap-3 font-medium text-amber-900">
    <input
      type="checkbox"
      checked={showDemo}
      onChange={(event) => setShowDemo(event.target.checked)}
      className="h-4 w-4"
    />
    Show sample recall alert (Demo only)
  </label>

  <p className="mt-2 text-sm text-amber-800">
    Demonstration data only. These are not real IdentIQ
    reviews or published price changes. No review decisions
    will be modified.
  </p>
</div>


        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Reviews Requiring Reassessment
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Only reviews with confirmed outdated price dependencies
              should appear here.
            </p>
          </div>

          {impacts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
              <Radar
                size={36}
                className="mx-auto mb-4 text-slate-400"
              />

              <h3 className="font-semibold text-slate-800">
                Awaiting data integration
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                The detection engine is ready, but live review and
                published-price data are not connected yet.
                No alert results are available.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {impacts.map((impact) => (
                <article
                  key={impact.alertKey}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-5"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold text-slate-900">
                      Review: {impact.reviewId}
                    </h3>

                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                      <AlertTriangle size={14} />
                      Needs reassessment
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-slate-600">
                      Originally used:{" "}
                      {formatPrice(
                        impact.usedAmountMinor,
                        impact.usedCurrency
                      )}
                    </span>

                    <ArrowRight size={16} className="text-slate-400" />

                    <span className="font-semibold text-slate-900">
                      New price:{" "}
                      {formatPrice(
                        impact.newAmountMinor,
                        impact.newCurrency
                      )}
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Price fact: {impact.factId}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mb-8 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">
            Inspect Review Evidence
          </h2>

          <p className="mt-2 text-sm text-slate-600">
            Search for reviews referencing a specific evidence source.
            A match is not confirmation of a price change.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              aria-label="Evidence source ID"
              placeholder="Exact source ID"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />

            <input
              aria-label="Evidence source type"
              placeholder="Exact source type"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value)}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          {sourceId.trim() && sourceType.trim() ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-medium text-slate-700">
                {matchingEvidence.length} matching evidence reference(s)
              </p>

              {matchingEvidence.map((match) => (
                <div
                  key={JSON.stringify([
                    match.reviewId,
                    match.analysisRunId,
                    match.sourceId,
                    match.sourceType,
                    match.versionId,
                  ])}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <p className="font-medium text-slate-900">
                    {match.reviewTitle}
                  </p>

                  <p className="mt-1 text-xs text-slate-600">
                    Review ID: {match.reviewId}
                  </p>

                  <p className="text-xs text-slate-600">
                    Evidence version: {match.versionId}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Enter both fields to inspect saved evidence.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
