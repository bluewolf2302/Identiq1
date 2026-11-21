
import test from "node:test";
import assert from "node:assert/strict";

import { detectRecallImpacts } from "../lib/recall/impact-detector";

import type {
  PublishedPriceChange,
  ReviewPriceDependency,
} from "../lib/recall/types";

const validPriceChange: PublishedPriceChange = {
  organisationId: "org-1",
  brandId: "brand-1",
  productId: "product-1",
  factId: "price-fact-1",
  previousVersionId: "v1",
  newVersionId: "v2",
  supersededVersionIds: ["v1"],
  previousAmountMinor: 49900,
  newAmountMinor: 59900,
  previousCurrency: "INR",
  newCurrency: "INR",
  status: "published",
};

const validReviewDependency: ReviewPriceDependency = {
  organisationId: "org-1",
  brandId: "brand-1",
  reviewId: "review-1",
  revisionId: "revision-1",
  analysisRunId: "analysis-1",
  productId: "product-1",
  factId: "price-fact-1",
  versionId: "v1",
};

test("flags a review that used an older published price", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-1",
    revisionId: "revision-1",
    analysisRunId: "analysis-1",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].reviewId, "review-1");
  assert.equal(impacts[0].newVersionId, "v2");
});



test("does not flag reviews for draft price changes", () => {
  const draftChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "draft",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-1",
    revisionId: "revision-1",
    analysisRunId: "analysis-1",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [draftChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("does not flag reviews when published price remains unchanged", () => {
  const unchangedPrice: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 49900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-1",
    revisionId: "revision-1",
    analysisRunId: "analysis-1",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [unchangedPrice],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("does not flag reviews depending on an unrelated product", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-A",
    factId: "price-fact-A",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-B",
    revisionId: "revision-B",
    analysisRunId: "analysis-B",

    productId: "product-B",
    factId: "price-fact-B",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("does not flag reviews belonging to another organisation", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-A",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-B",
    brandId: "brand-1",

    reviewId: "review-B",
    revisionId: "revision-B",
    analysisRunId: "analysis-B",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("does not flag reviews belonging to another brand", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-A",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-B",

    reviewId: "review-B",
    revisionId: "revision-B",
    analysisRunId: "analysis-B",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("does not flag reviews already using the new price version", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-2",
    revisionId: "revision-2",
    analysisRunId: "analysis-2",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v2",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("flags reviews using older versions after multiple price updates", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v2",
    newVersionId: "v3",
    supersededVersionIds: ["v1", "v2"],

    previousAmountMinor: 59900,
    newAmountMinor: 69900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-old",
    revisionId: "revision-old",
    analysisRunId: "analysis-old",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].reviewId, "review-old");
  assert.equal(impacts[0].usedVersionId, "v1");
  assert.equal(impacts[0].newVersionId, "v3");
});



test("does not create duplicate impacts for repeated events", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-1",
    revisionId: "revision-1",
    analysisRunId: "analysis-1",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange, priceChange],
    [dependency, dependency]
  );

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].reviewId, "review-1");
});



test("flags reviews when the published price currency changes", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 49900,

    previousCurrency: "INR",
    newCurrency: "USD",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-1",
    revisionId: "revision-1",
    analysisRunId: "analysis-1",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].previousCurrency, "INR");
  assert.equal(impacts[0].newCurrency, "USD");
});



test("does not infer an impact without superseded version evidence", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v2",
    newVersionId: "v3",
    supersededVersionIds: [],

    previousAmountMinor: 59900,
    newAmountMinor: 69900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-old",
    revisionId: "revision-old",
    analysisRunId: "analysis-old",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 0);
});



test("flags multiple affected reviews but ignores current reviews", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependencies: ReviewPriceDependency[] = [
    {
      organisationId: "org-1",
      brandId: "brand-1",
      reviewId: "review-A",
      revisionId: "revision-A",
      analysisRunId: "analysis-A",
      productId: "product-1",
      factId: "price-fact-1",
      versionId: "v1",
    },
    {
      organisationId: "org-1",
      brandId: "brand-1",
      reviewId: "review-B",
      revisionId: "revision-B",
      analysisRunId: "analysis-B",
      productId: "product-1",
      factId: "price-fact-1",
      versionId: "v1",
    },
    {
      organisationId: "org-1",
      brandId: "brand-1",
      reviewId: "review-C",
      revisionId: "revision-C",
      analysisRunId: "analysis-C",
      productId: "product-1",
      factId: "price-fact-1",
      versionId: "v2",
    },
  ];

  const impacts = detectRecallImpacts(
    [priceChange],
    dependencies
  );

  assert.equal(impacts.length, 2);

  const affectedReviewIds = impacts.map(
    (impact) => impact.reviewId
  );

  assert.deepEqual(
    affectedReviewIds.sort(),
    ["review-A", "review-B"]
  );
});



test("keeps different revisions of the same review separate", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v1",
    newVersionId: "v2",
    supersededVersionIds: ["v1"],

    previousAmountMinor: 49900,
    newAmountMinor: 59900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependencies: ReviewPriceDependency[] = [
    {
      organisationId: "org-1",
      brandId: "brand-1",
      reviewId: "review-1",
      revisionId: "revision-1",
      analysisRunId: "analysis-1",
      productId: "product-1",
      factId: "price-fact-1",
      versionId: "v1",
    },
    {
      organisationId: "org-1",
      brandId: "brand-1",
      reviewId: "review-1",
      revisionId: "revision-2",
      analysisRunId: "analysis-2",
      productId: "product-1",
      factId: "price-fact-1",
      versionId: "v1",
    },
  ];

  const impacts = detectRecallImpacts(
    [priceChange],
    dependencies
  );

  assert.equal(impacts.length, 2);

  const revisionIds = impacts.map(
    (impact) => impact.revisionId
  );

  assert.deepEqual(
    revisionIds.sort(),
    ["revision-1", "revision-2"]
  );

  assert.notEqual(
    impacts[0].alertKey,
    impacts[1].alertKey
  );
});


test("preserves the original price used during review", () => {
  const priceChange: PublishedPriceChange = {
    organisationId: "org-1",
    brandId: "brand-1",
    productId: "product-1",
    factId: "price-fact-1",

    previousVersionId: "v2",
    newVersionId: "v3",
    supersededVersionIds: ["v1", "v2"],

    previousAmountMinor: 59900,
    newAmountMinor: 69900,

    previousCurrency: "INR",
    newCurrency: "INR",

    status: "published",
  };

  const dependency: ReviewPriceDependency = {
    organisationId: "org-1",
    brandId: "brand-1",

    reviewId: "review-old",
    revisionId: "revision-old",
    analysisRunId: "analysis-old",

    productId: "product-1",
    factId: "price-fact-1",
    versionId: "v1",

    usedAmountMinor: 49900,
    usedCurrency: "INR",
  };

  const impacts = detectRecallImpacts(
    [priceChange],
    [dependency]
  );

  assert.equal(impacts.length, 1);

  assert.equal(impacts[0].usedVersionId, "v1");
  assert.equal(impacts[0].usedAmountMinor, 49900);
  assert.equal(impacts[0].usedCurrency, "INR");

  assert.equal(impacts[0].newVersionId, "v3");
  assert.equal(impacts[0].newAmountMinor, 69900);

  assert.equal(impacts[0].previousAmountMinor, 59900);
});

test("ignores invalid price amounts, currencies, and version identities", () => {
  const invalidChanges: PublishedPriceChange[] = [
    { ...validPriceChange, previousAmountMinor: Number.NaN },
    { ...validPriceChange, newAmountMinor: -1 },
    { ...validPriceChange, newAmountMinor: 59900.5 },
    { ...validPriceChange, newCurrency: "inr" },
    { ...validPriceChange, factId: " " },
    { ...validPriceChange, supersededVersionIds: [] },
    {
      ...validPriceChange,
      supersededVersionIds: ["v1", "v2"],
    },
  ];

  for (const change of invalidChanges) {
    assert.deepEqual(detectRecallImpacts([change], [validReviewDependency]), []);
  }
});

test("requires matching stable product identity even when fact IDs match", () => {
  const dependency = {
    ...validReviewDependency,
    productId: "another-product",
  };

  assert.deepEqual(
    detectRecallImpacts([validPriceChange], [dependency]),
    [],
  );
});

test("ignores dependencies with invalid optional price values", () => {
  const invalidDependencies: ReviewPriceDependency[] = [
    { ...validReviewDependency, usedAmountMinor: 59900.5 },
    { ...validReviewDependency, usedAmountMinor: -1 },
    { ...validReviewDependency, usedCurrency: "inr" },
  ];

  for (const dependency of invalidDependencies) {
    assert.deepEqual(detectRecallImpacts([validPriceChange], [dependency]), []);
  }
});
