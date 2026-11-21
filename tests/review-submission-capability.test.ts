import assert from "node:assert/strict";
import test from "node:test";

import {
  callPostgrest,
  type PostgrestResponse,
} from "../lib/supabase/client";
import { SupabaseReviewRepository } from "../lib/repositories/review-repository";
import type { ReviewSubmission } from "../lib/types";

const review: ReviewSubmission = {
  id: "review-1",
  title: "Test review",
  contentType: "Campaign Copy",
  guidelineCollection: "Brand Guidelines",
  submittedBy: "Reviewer",
  submittedAt: "2026-01-01",
  status: "Pending Approval",
  complianceScore: 90,
  textContent: "Example copy",
  pastelTheme: "blue",
  findings: [
    {
      id: "finding-1",
      category: "Brand Claims",
      title: "Price claim",
      description: "Price evidence",
      severity: "low",
      evidenceStatus: "supported",
      detectedValue: "₹499",
      expectedValue: "₹499",
      sourceReference: "Product record",
      recommendation: "",
      affectedContent: "₹499",
      resolved: false,
      comments: [],
      evidenceReferences: [
        {
          sourceId: "product-fact-1",
          sourceType: "product-fact",
          sourceTitle: "Approved product facts",
          versionId: "source-version-1",
        },
      ],
      sourceVersionIds: ["source-version-1"],
    },
  ],
};

function createPostgrestCaller(options: {
  openApiDocument?: unknown;
  openApiError?: PostgrestResponse<unknown>["error"];
  evidenceRpcError?: PostgrestResponse<unknown>["error"];
}) {
  const calls: Array<{
    path: string;
    options?: Parameters<typeof callPostgrest>[1];
  }> = [];

  const caller = async <T>(
    path: string,
    requestOptions?: Parameters<typeof callPostgrest>[1],
  ): Promise<PostgrestResponse<T>> => {
    calls.push({ path, options: requestOptions });

    if (path === "/rest/v1/") {
      return options.openApiError
        ? { data: null, error: options.openApiError, status: 0 }
        : {
            data: (options.openApiDocument ?? { paths: {} }) as T,
            error: null,
            status: 200,
          };
    }

    if (
      path === "/rest/v1/rpc/submit_review_atomic_with_evidence" &&
      options.evidenceRpcError
    ) {
      return {
        data: null,
        error: options.evidenceRpcError,
        status: 0,
      };
    }

    return {
      data: { review_id: review.id, compliance_score: review.complianceScore } as T,
      error: null,
      status: 200,
    };
  };

  return { caller, calls };
}

test("uses the original submission RPC when the evidence capability is absent", async () => {
  const { caller, calls } = createPostgrestCaller({
    openApiDocument: { paths: { "/rpc/submit_review_atomic": { post: {} } } },
  });
  const repository = new SupabaseReviewRepository(caller);

  await repository.submitReview({
    review,
    organisationId: "org-1",
    brandId: "brand-1",
  });

  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/rest/v1/", "/rest/v1/rpc/submit_review_atomic"],
  );
});

test("uses the evidence RPC only when the OpenAPI capability is advertised", async () => {
  const { caller, calls } = createPostgrestCaller({
    openApiDocument: {
      paths: {
        "/rpc/submit_review_atomic_with_evidence": { post: {} },
      },
    },
  });
  const repository = new SupabaseReviewRepository(caller);

  await repository.submitReview({
    review,
    organisationId: "org-1",
    brandId: "brand-1",
  });

  assert.equal(
    calls[1]?.path,
    "/rest/v1/rpc/submit_review_atomic_with_evidence",
  );
  const body = calls[1]?.options?.body;
  assert.ok(body && typeof body === "object");
  assert.deepEqual(
    Reflect.get(body, "p_findings"),
    review.findings,
  );
});

test("uses the original RPC when capability discovery is unavailable", async () => {
  const { caller, calls } = createPostgrestCaller({
    openApiError: { code: "NETWORK_ERROR", message: "Probe unavailable" },
  });
  const repository = new SupabaseReviewRepository(caller);

  await repository.submitReview({
    review,
    organisationId: "org-1",
    brandId: "brand-1",
  });

  assert.equal(calls[1]?.path, "/rest/v1/rpc/submit_review_atomic");
});

test("does not retry the legacy RPC after an ambiguous evidence RPC failure", async () => {
  const { caller, calls } = createPostgrestCaller({
    openApiDocument: {
      paths: {
        "/rpc/submit_review_atomic_with_evidence": { post: {} },
      },
    },
    evidenceRpcError: {
      code: "NETWORK_ERROR",
      message: "Connection lost after request",
    },
  });
  const repository = new SupabaseReviewRepository(caller);

  await assert.rejects(
    repository.submitReview({
      review,
      organisationId: "org-1",
      brandId: "brand-1",
    }),
  );
  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/rest/v1/", "/rest/v1/rpc/submit_review_atomic_with_evidence"],
  );
});
