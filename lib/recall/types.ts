
export type PublishedPriceChange = {
  organisationId: string;
  brandId: string;
  productId: string;
  factId: string;

  previousVersionId: string;
  newVersionId: string;
  supersededVersionIds: string[];

  previousAmountMinor: number;
  newAmountMinor: number;

  previousCurrency: string;
  newCurrency: string;

  status: "draft" | "published";
};

export type ReviewPriceDependency = {
  organisationId: string;
  brandId: string;

  reviewId: string;
  revisionId: string;
  analysisRunId: string;

  factId: string;
  versionId: string;

  usedAmountMinor?: number;
  usedCurrency?: string;


};


export type RecallImpact = {
  alertKey: string;

  organisationId: string;
  brandId: string;

  reviewId: string;
  revisionId: string;
  analysisRunId: string;

  productId: string;
  factId: string;

  usedVersionId: string;
  newVersionId: string;

  usedAmountMinor?: number;
  usedCurrency?: string;


  previousAmountMinor: number;
  newAmountMinor: number;

  previousCurrency: string;
  newCurrency: string;
};

