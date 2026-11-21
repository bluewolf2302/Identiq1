
import type {
  PublishedPriceChange,
  ReviewPriceDependency,
} from "./types";

export const demoPriceChanges: PublishedPriceChange[] = [
  {
    organisationId: "demo-org",
    brandId: "demo-brand",
    productId: "demo-product",
    factId: "demo-price-fact",
    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],
    previousAmountMinor: 49900,
    newAmountMinor: 69900,
    previousCurrency: "INR",
    newCurrency: "INR",
    status: "published",
  },
];

export const demoReviewDependencies: ReviewPriceDependency[] = [
  {
    organisationId: "demo-org",
    brandId: "demo-brand",
    reviewId: "DEMO-REVIEW-001",
    revisionId: "demo-revision-1",
    analysisRunId: "demo-analysis-1",
    factId: "demo-price-fact",
    versionId: "v1",
    usedAmountMinor: 49900,
    usedCurrency: "INR",
  },
];
