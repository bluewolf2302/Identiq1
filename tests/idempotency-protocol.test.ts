import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalPayload,
  canonicalizeValue,
  computePayloadHash,
  generateIdempotencyKey,
  mapPostgrestError,
} from "../lib/repositories/idempotency";

describe("Idempotency Protocol & Canonical Hashing", () => {
  it("generates unique idempotency keys with operation prefix", () => {
    const key1 = generateIdempotencyKey("submit_review");
    const key2 = generateIdempotencyKey("submit_review");

    assert.ok(key1.startsWith("submit_review-"));
    assert.ok(key2.startsWith("submit_review-"));
    assert.notEqual(key1, key2);
  });

  it("canonicalizes text with line endings and whitespace trimming while preserving internal spaces", () => {
    const raw = "  Paragraph one\r\n\r\nParagraph two with  multiple   spaces.  \r\n";
    const canonical = canonicalizeValue(raw);

    assert.equal(canonical, "Paragraph one\n\nParagraph two with  multiple   spaces.");
  });

  it("sorts object keys lexicographically in canonical JSON", () => {
    const input1 = {
      title: "Launch Copy",
      category: "Brand Claims",
      asset_id: "ast-1",
      compliance_score: 95,
    };
    const input2 = {
      compliance_score: 95,
      asset_id: "ast-1",
      title: "Launch Copy",
      category: "Brand Claims",
    };

    const canonical1 = buildCanonicalPayload(input1);
    const canonical2 = buildCanonicalPayload(input2);

    assert.equal(canonical1, canonical2);
    assert.equal(
      canonical1,
      '{"asset_id":"ast-1","category":"Brand Claims","compliance_score":95,"title":"Launch Copy"}'
    );
  });

  it("produces identical SHA-256 hashes for equivalent payloads regardless of key ordering or CRLF", async () => {
    const payloadA = {
      title: "Teralune Social Copy",
      text_content: "Headline\r\nBody text\r\n",
      brand_id: "b-01",
    };
    const payloadB = {
      brand_id: "b-01",
      text_content: "Headline\nBody text",
      title: "Teralune Social Copy",
    };

    const hashA = await computePayloadHash(buildCanonicalPayload(payloadA));
    const hashB = await computePayloadHash(buildCanonicalPayload(payloadB));

    assert.equal(hashA, hashB);
    assert.match(hashA, /^[0-9a-f]{64}$/);
  });

  it("produces different SHA-256 hashes when content differs meaningfully", async () => {
    const payloadA = {
      title: "Teralune Social Copy",
      text_content: "Headline A",
    };
    const payloadB = {
      title: "Teralune Social Copy",
      text_content: "Headline B",
    };

    const hashA = await computePayloadHash(buildCanonicalPayload(payloadA));
    const hashB = await computePayloadHash(buildCanonicalPayload(payloadB));

    assert.notEqual(hashA, hashB);
  });

  describe("Error Mapping & Conflict Disambiguation", () => {
    it("maps idempotency payload conflict to HTTP 409 Non-Retryable", () => {
      const mapped = mapPostgrestError({
        code: "P0001",
        message: 'IDEMPOTENCY_CONFLICT: Key "k-101" was already used with a different request payload',
        hint: "idempotency_payload_mismatch",
        details: '{"key":"k-101","operation":"submit_review"}',
      });

      assert.equal(mapped.status, 409);
      assert.equal(mapped.error, "IDEMPOTENCY_CONFLICT");
      assert.equal(mapped.retryable, false);
      assert.deepEqual(mapped.details, { key: "k-101", operation: "submit_review" });
    });

    it("maps concurrent in-progress lock / stuck started to HTTP 409 Retryable with Retry-After header hint", () => {
      const mapped = mapPostgrestError({
        code: "55P03",
        message: 'IDEMPOTENCY_IN_PROGRESS: Key "k-102" is currently processing',
        hint: "idempotency_in_progress",
      });

      assert.equal(mapped.status, 409);
      assert.equal(mapped.error, "IDEMPOTENCY_IN_PROGRESS");
      assert.equal(mapped.retryable, true);
      assert.equal(mapped.retryAfterSeconds, 2);
    });

    it("maps generic 23505 unique constraint violation to HTTP 400 Bad Request, NOT 409 Conflict", () => {
      const mapped = mapPostgrestError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "reviews_pkey"',
        details: 'Key (id)=(rev-101) already exists.',
      });

      assert.equal(mapped.status, 400);
      assert.equal(mapped.error, "RESOURCE_ALREADY_EXISTS");
      assert.equal(mapped.retryable, false);
    });

    it("maps tenancy authorization failure 42501 to HTTP 403 Forbidden", () => {
      const mapped = mapPostgrestError({
        code: "42501",
        message: "Forbidden: User is not an organisation member",
      });

      assert.equal(mapped.status, 403);
      assert.equal(mapped.error, "FORBIDDEN");
      assert.equal(mapped.retryable, false);
    });

    it("maps missing entity P0002 to HTTP 404 Not Found", () => {
      const mapped = mapPostgrestError({
        code: "P0002",
        message: "Review not found: rev-999",
      });

      assert.equal(mapped.status, 404);
      assert.equal(mapped.error, "NOT_FOUND");
      assert.equal(mapped.retryable, false);
    });
  });
});
