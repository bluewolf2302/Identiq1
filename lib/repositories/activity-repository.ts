/**
 * Activity Events Repository
 *
 * Provides typed interface and implementations for activity timeline persistence.
 * In authenticated mode, events are loaded from the dedicated activity_events table.
 * Review lifecycle events are written atomically with their RPC mutations.
 */

import { ActivityEvent } from "../types";
import { callPostgrest } from "../supabase/client";
import { mapPostgrestError } from "./idempotency";
import { INITIAL_ACTIVITY } from "../seed-data";

export interface ActivityRepository {
  fetchActivities(organisationId?: string, limit?: number): Promise<ActivityEvent[]>;
  recordActivity(event: ActivityEvent, organisationId: string): Promise<void>;
}

export class SupabaseActivityRepository implements ActivityRepository {
  async fetchActivities(organisationId?: string, limit = 100): Promise<ActivityEvent[]> {
    const query = organisationId
      ? `/rest/v1/activity_events?organisation_id=eq.${organisationId}&order=timestamp.desc&limit=${limit}`
      : `/rest/v1/activity_events?order=timestamp.desc&limit=${limit}`;

    const res = await callPostgrest<Record<string, unknown>[]>(query);
    if (res.error) throw mapPostgrestError(res.error);
    if (!Array.isArray(res.data)) return [];

    return res.data.map((row) => ({
      id: String(row.id),
      reviewId: row.review_id ? String(row.review_id) : undefined,
      actor: String(row.actor),
      action: String(row.action),
      target: String(row.target),
      timestamp: String(row.timestamp),
      type: row.type as ActivityEvent["type"],
    }));
  }

  async recordActivity(event: ActivityEvent, organisationId: string): Promise<void> {
    const payload = {
      id: event.id,
      organisation_id: organisationId,
      review_id: event.reviewId || null,
      actor: event.actor,
      action: event.action,
      target: event.target,
      type: event.type,
      timestamp: event.timestamp,
    };

    const res = await callPostgrest("/rest/v1/activity_events", {
      method: "POST",
      body: payload,
    });

    if (res.error) throw mapPostgrestError(res.error);
  }
}

export class LocalActivityRepository implements ActivityRepository {
  private activities: ActivityEvent[];

  constructor(initialActivities: ActivityEvent[] = INITIAL_ACTIVITY) {
    this.activities = [...initialActivities];
  }

  async fetchActivities(): Promise<ActivityEvent[]> {
    return [...this.activities];
  }

  async recordActivity(event: ActivityEvent): Promise<void> {
    this.activities = [event, ...this.activities];
  }
}
