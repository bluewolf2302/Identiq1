/**
 * Idempotency Protocol & Canonical Hashing Utilities for IdentIQ
 *
 * Implements deterministic canonical payload serialization and hashing
 * matching the PostgreSQL RPC single-transaction reservation protocol.
 */

import { PostgrestError } from "../supabase/client";

export interface MappedAppError {
  error: string;
  message: string;
  status: number;
  retryable: boolean;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
}

/**
 * Generate a unique client idempotency key for an operation.
 */
export function generateIdempotencyKey(operation: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 10);
  return `${operation}-${ts}-${rand}`;
}

/**
 * Recursively canonicalize values:
 * - Strings: trim whitespace, normalize \r\n to \n.
 * - Objects: sort keys lexicographically.
 * - Arrays: preserve or sort deterministically.
 * - Nulls/Undefined: normalized to null.
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return null;
  }

  if (typeof val === "string") {
    return val.replace(/\r\n/g, "\n").trim();
  }

  if (typeof val === "number" || typeof val === "boolean") {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeValue(item));
  }

  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeValue(obj[key]);
    }
    return result;
  }

  return String(val);
}

/**
 * Serialize a payload into its deterministic JSON canonical form.
 */
export function buildCanonicalPayload(payload: Record<string, unknown>): string {
  const canonicalObj = canonicalizeValue(payload);
  return JSON.stringify(canonicalObj);
}

/**
 * Compute hex SHA-256 hash using standard Web Crypto or Node.js crypto.
 */
export async function computePayloadHash(canonicalString: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalString);

  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const hashBuffer = await subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  throw new Error("No cryptographic hashing provider available in environment.");
}

/**
 * Disambiguate PostgREST errors into typed application responses.
 * Never conflates generic 23505 with idempotency conflict.
 */
export function mapPostgrestError(error: PostgrestError): MappedAppError {
  const message = error.message || "";
  const hint = error.hint || "";
  const code = error.code || "";

  // 1. Idempotency Payload Mismatch Conflict
  if (
    message.includes("IDEMPOTENCY_CONFLICT") ||
    hint === "idempotency_payload_mismatch"
  ) {
    let parsedDetails: Record<string, unknown> | undefined;
    if (error.details) {
      try {
        parsedDetails = JSON.parse(error.details);
      } catch {
        // preserve undefined
      }
    }
    return {
      error: "IDEMPOTENCY_CONFLICT",
      message:
        "This idempotency key has already been used with a different request payload.",
      status: 409,
      retryable: false,
      details: parsedDetails,
    };
  }

  // 2. Idempotency In Progress / Lock Wait / Stuck Started
  if (
    message.includes("IDEMPOTENCY_IN_PROGRESS") ||
    hint === "idempotency_in_progress" ||
    hint === "idempotency_stuck_started" ||
    code === "55P03"
  ) {
    return {
      error: "IDEMPOTENCY_IN_PROGRESS",
      message:
        "An operation with this idempotency key is currently processing. Please retry.",
      status: 409,
      retryable: true,
      retryAfterSeconds: 2,
    };
  }

  // 3. Entity Not Found
  if (code === "P0002" || message.includes("not found")) {
    return {
      error: "NOT_FOUND",
      message: message || "Target resource was not found.",
      status: 404,
      retryable: false,
    };
  }

  // 4. Permission / Tenancy Denied
  if (code === "42501" || message.includes("Forbidden") || message.includes("Unauthorized")) {
    return {
      error: "FORBIDDEN",
      message: message || "You do not have permission to access or modify this resource.",
      status: 403,
      retryable: false,
    };
  }

  // 5. General Unique Constraint Violation (Resource ID Collision)
  if (code === "23505") {
    return {
      error: "RESOURCE_ALREADY_EXISTS",
      message: "A resource with this identifier already exists in the system.",
      status: 400,
      retryable: false,
    };
  }

  // 6. Validation Error
  if (code === "22023" || code === "23514") {
    return {
      error: "VALIDATION_FAILED",
      message: message || "Invalid input parameters or state transition.",
      status: 400,
      retryable: false,
    };
  }

  // 7. General Internal Error
  return {
    error: "DATABASE_ERROR",
    message: message || "An unexpected database error occurred.",
    status: 500,
    retryable: true,
  };
}
