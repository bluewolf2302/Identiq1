


import type {
  PublishedPriceChange,
  ReviewPriceDependency,
  RecallImpact,
} from "./types";

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidMinorAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function isRelevantPublishedPriceChange(
  change: PublishedPriceChange
): boolean {
  return (
    change.status === "published" &&
    isNonEmptyIdentifier(change.organisationId) &&
    isNonEmptyIdentifier(change.brandId) &&
    isNonEmptyIdentifier(change.productId) &&
    isNonEmptyIdentifier(change.factId) &&
    isNonEmptyIdentifier(change.previousVersionId) &&
    isNonEmptyIdentifier(change.newVersionId) &&
    change.previousVersionId !== change.newVersionId &&
    Array.isArray(change.supersededVersionIds) &&
    change.supersededVersionIds.every(isNonEmptyIdentifier) &&
    change.supersededVersionIds.includes(change.previousVersionId) &&
    !change.supersededVersionIds.includes(change.newVersionId) &&
    isValidMinorAmount(change.previousAmountMinor) &&
    isValidMinorAmount(change.newAmountMinor) &&
    isValidCurrency(change.previousCurrency) &&
    isValidCurrency(change.newCurrency) &&
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
    change.productId === dependency.productId &&
    change.factId === dependency.factId
  );
}

function isValidDependency(dependency: ReviewPriceDependency): boolean {
  return (
    isNonEmptyIdentifier(dependency.organisationId) &&
    isNonEmptyIdentifier(dependency.brandId) &&
    isNonEmptyIdentifier(dependency.reviewId) &&
    isNonEmptyIdentifier(dependency.revisionId) &&
    isNonEmptyIdentifier(dependency.analysisRunId) &&
    isNonEmptyIdentifier(dependency.productId) &&
    isNonEmptyIdentifier(dependency.factId) &&
    isNonEmptyIdentifier(dependency.versionId) &&
    (dependency.usedAmountMinor === undefined ||
      isValidMinorAmount(dependency.usedAmountMinor)) &&
    (dependency.usedCurrency === undefined ||
      isValidCurrency(dependency.usedCurrency))
  );
}

export function shouldFlagReviewForPriceChange(
  change: PublishedPriceChange,
  dependency: ReviewPriceDependency
): boolean {
  return (
    isRelevantPublishedPriceChange(change) &&
    isValidDependency(dependency) &&
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
      change.productId,
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
