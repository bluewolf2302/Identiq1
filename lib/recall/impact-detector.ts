


import type {
  PublishedPriceChange,
  ReviewPriceDependency,
  RecallImpact,
} from "./types";


export function isRelevantPublishedPriceChange(
  change: PublishedPriceChange
): boolean {
  return (
    change.status === "published" &&
    (
      change.previousAmountMinor !== change.newAmountMinor ||
      change.previousCurrency !== change.newCurrency
    )
  );
}

export function isDependencyForChangedPrice(
  change: PublishedPriceChange,
  dependency: ReviewPriceDependency
): boolean {
  return (
    change.organisationId === dependency.organisationId &&
    change.brandId === dependency.brandId &&
    change.factId === dependency.factId
  );
}



export function shouldFlagReviewForPriceChange(
  change: PublishedPriceChange,
  dependency: ReviewPriceDependency
): boolean {
  return (
    isRelevantPublishedPriceChange(change) &&
    isDependencyForChangedPrice(change, dependency) &&
    dependency.versionId !== change.newVersionId &&
    change.supersededVersionIds.includes(dependency.versionId)
  );
}



export function createRecallImpact(
  change: PublishedPriceChange,
  dependency: ReviewPriceDependency
): RecallImpact | null {
  if (!shouldFlagReviewForPriceChange(change, dependency)) {
    return null;
  }

  return {
    alertKey: JSON.stringify([
      change.organisationId,
      change.brandId,
      dependency.reviewId,
      dependency.revisionId,
      change.factId,
      change.newVersionId,
    ]),

    organisationId: change.organisationId,
    brandId: change.brandId,

    reviewId: dependency.reviewId,
    revisionId: dependency.revisionId,
    analysisRunId: dependency.analysisRunId,

    productId: change.productId,
    factId: change.factId,

    usedVersionId: dependency.versionId,
    newVersionId: change.newVersionId,

    usedAmountMinor: dependency.usedAmountMinor,
    usedCurrency: dependency.usedCurrency,

    previousAmountMinor: change.previousAmountMinor,
    newAmountMinor: change.newAmountMinor,

    previousCurrency: change.previousCurrency,
    newCurrency: change.newCurrency,
  };
}



export function detectRecallImpacts(
  changes: PublishedPriceChange[],
  dependencies: ReviewPriceDependency[]
): RecallImpact[] {
  const impactsByKey = new Map<string, RecallImpact>();

  for (const change of changes) {
    for (const dependency of dependencies) {
      const impact = createRecallImpact(change, dependency);

      if (impact && !impactsByKey.has(impact.alertKey)) {
        impactsByKey.set(impact.alertKey, impact);
      }
    }
  }

  return Array.from(impactsByKey.values());
}
