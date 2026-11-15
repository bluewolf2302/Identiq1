/**
 * IdentIQ Repositories Composition Root
 */

import { getSupabaseIntegrationStatus } from "../supabase/client";
import { ReviewRepository, SupabaseReviewRepository, LocalReviewRepository } from "./review-repository";
import { ActivityRepository, SupabaseActivityRepository, LocalActivityRepository } from "./activity-repository";
import { DemoReviewRepository, DemoActivityRepository } from "./demo-repository";

export * from "./idempotency";
export * from "./review-repository";
export * from "./activity-repository";
export * from "./demo-repository";

export function createReviewRepository(authToken?: string | null): ReviewRepository {
  const status = getSupabaseIntegrationStatus(authToken);
  if (status.mode === "AUTHENTICATED_SUPABASE") {
    return new SupabaseReviewRepository();
  }
  if (status.mode === "SHARED_DEMO") {
    return new DemoReviewRepository();
  }
  return new LocalReviewRepository();
}

export function createActivityRepository(authToken?: string | null): ActivityRepository {
  const status = getSupabaseIntegrationStatus(authToken);
  if (status.mode === "AUTHENTICATED_SUPABASE") {
    return new SupabaseActivityRepository();
  }
  if (status.mode === "SHARED_DEMO") {
    return new DemoActivityRepository();
  }
  return new LocalActivityRepository();
}
