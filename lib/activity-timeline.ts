import { ActivityEvent, ReviewSubmission } from "./types";

export type ActivityEventType = ActivityEvent["type"];

export type ActivityDateRange = "all" | "today" | "7d" | "30d" | "legacy";

export type ActivityDateGroup = "Today" | "Yesterday" | "Older" | "Legacy / Undated";

export interface ActivityFilters {
  eventType: "all" | ActivityEventType;
  actor: string; // "all" or specific actor name
  dateRange: ActivityDateRange;
  searchQuery: string;
}

export interface ActivityTimeInfo {
  display: string;
  absolute?: string;
  isLegacy: boolean;
  parsedDate: Date | null;
  dateGroup: ActivityDateGroup;
}

export const ACTIVITY_EVENT_META: Record<
  ActivityEventType,
  {
    label: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
    badgeBg: string;
  }
> = {
  submitted: {
    label: "Submission",
    bgClass: "bg-[#DDF0FA]/60",
    borderClass: "border-[#CBE2EF]",
    textClass: "text-[#1E3A8A]",
    badgeBg: "bg-[#DDF0FA]",
  },
  approved: {
    label: "Approval",
    bgClass: "bg-[#CDEEE0]/60",
    borderClass: "border-[#BAE0D0]",
    textClass: "text-[#14532D]",
    badgeBg: "bg-[#CDEEE0]",
  },
  changes_requested: {
    label: "Changes Requested",
    bgClass: "bg-[#F6D5DA]/60",
    borderClass: "border-[#EBC3CA]",
    textClass: "text-[#7F1D1D]",
    badgeBg: "bg-[#F6D5DA]",
  },
  resolved: {
    label: "Finding Resolved",
    bgClass: "bg-[#CDEEE0]/50",
    borderClass: "border-[#BAE0D0]",
    textClass: "text-[#14532D]",
    badgeBg: "bg-[#CDEEE0]",
  },
  knowledge_updated: {
    label: "Knowledge Hub",
    bgClass: "bg-[#E2DBFB]/60",
    borderClass: "border-[#D3CAEE]",
    textClass: "text-[#4A3E7A]",
    badgeBg: "bg-[#E2DBFB]",
  },
  asset_uploaded: {
    label: "Asset Uploaded",
    bgClass: "bg-[#F9DEC0]/60",
    borderClass: "border-[#EDD0AF]",
    textClass: "text-[#7C2D12]",
    badgeBg: "bg-[#F9DEC0]",
  },
};

/**
 * Checks if a string is a valid ISO 8601 timestamp.
 * Rejects legacy relative/approximate strings like "12 mins ago", "Yesterday", "Nov 10, 2026".
 */
export function parseActivityDate(timestamp?: string | null): Date | null {
  if (!timestamp || typeof timestamp !== "string") return null;
  const trimmed = timestamp.trim();
  if (!trimmed) return null;

  // Strict ISO 8601 format check (e.g. 2026-11-14T10:30:00.000Z or 2026-11-14T10:30:00)
  const isIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(
    trimmed,
  );
  if (!isIsoPattern) return null;

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns true if the timestamp is a legacy or unstandardized display value.
 */
export function isLegacyActivityTimestamp(timestamp?: string | null): boolean {
  return parseActivityDate(timestamp) === null;
}

/**
 * Formats relative time from a valid Date instance (e.g. "Just now", "5 mins ago", "2 hours ago").
 * When referenceNow is not provided (e.g. during initial SSR/prerender), returns a deterministic absolute date.
 */
export function formatActivityRelativeTime(
  date: Date,
  referenceNow?: Date | null,
): string {
  if (!referenceNow) {
    return formatActivityAbsoluteTime(date, { includeTime: false });
  }

  const diffMs = Math.max(0, referenceNow.getTime() - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 45) return "Just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} ${diffMin === 1 ? "min" : "mins"} ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return formatActivityAbsoluteTime(date, { includeTime: false });
}

/**
 * Formats an absolute timestamp string (e.g. "Nov 14, 2026 · 10:30 AM").
 */
export function formatActivityAbsoluteTime(
  date: Date,
  options: { includeTime?: boolean } = { includeTime: true },
): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const m = months[date.getMonth()];
  const d = date.getDate();
  const y = date.getFullYear();

  if (!options.includeTime) {
    return `${m} ${d}, ${y}`;
  }

  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;

  return `${m} ${d}, ${y} · ${displayHours}:${minutes} ${ampm}`;
}

/**
 * Categorizes an activity into a calendar group ("Today", "Yesterday", "Older", or "Legacy / Undated").
 */
export function getActivityDateGroup(
  timestamp?: string | null,
  referenceNow?: Date | null,
): ActivityDateGroup {
  const parsed = parseActivityDate(timestamp);
  if (!parsed) return "Legacy / Undated";
  if (!referenceNow) return "Older";

  // Check calendar days
  const eventDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const today = new Date(
    referenceNow.getFullYear(),
    referenceNow.getMonth(),
    referenceNow.getDate(),
  );

  const diffDays = Math.round((today.getTime() - eventDate.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return "Older";
}

/**
 * Retrieves full display and metadata for an activity timestamp, safely handling legacy strings.
 */
export function getActivityTimeInfo(
  timestamp?: string | null,
  referenceNow?: Date | null,
): ActivityTimeInfo {
  const parsed = parseActivityDate(timestamp);

  if (parsed) {
    return {
      display: referenceNow
        ? formatActivityRelativeTime(parsed, referenceNow)
        : formatActivityAbsoluteTime(parsed, { includeTime: false }),
      absolute: formatActivityAbsoluteTime(parsed),
      isLegacy: false,
      parsedDate: parsed,
      dateGroup: getActivityDateGroup(timestamp, referenceNow),
    };
  }

  // Legacy fallback: preserve original string, mark as legacy
  return {
    display: timestamp && timestamp.trim() ? timestamp.trim() : "Date unavailable",
    absolute: undefined,
    isLegacy: true,
    parsedDate: null,
    dateGroup: "Legacy / Undated",
  };
}

/**
 * Simple formatted timestamp for compact dashboard display.
 */
export function formatActivityTimestamp(
  timestamp?: string | null,
  referenceNow?: Date | null,
): string {
  const info = getActivityTimeInfo(timestamp, referenceNow);
  return info.display;
}

/**
 * Sorts activities chronologically with newest events first.
 * Events with valid ISO timestamps are sorted by datetime.
 * Legacy seed events are placed after ISO events with order preserved.
 */
export function sortActivitiesChronologically(activities: ActivityEvent[]): ActivityEvent[] {
  return [...activities].sort((a, b) => {
    const dateA = parseActivityDate(a.timestamp);
    const dateB = parseActivityDate(b.timestamp);

    // Both have valid ISO timestamps -> newest first
    if (dateA && dateB) {
      return dateB.getTime() - dateA.getTime();
    }

    // Only A has ISO timestamp -> A comes first
    if (dateA && !dateB) return -1;

    // Only B has ISO timestamp -> B comes first
    if (!dateA && dateB) return 1;

    // Both are legacy: sort by ID or keep order
    return b.id.localeCompare(a.id);
  });
}

/**
 * Gathers unique actor names across all activities.
 */
export function getUniqueActors(activities: ActivityEvent[]): string[] {
  const actorSet = new Set<string>();
  for (const act of activities) {
    if (act.actor && act.actor.trim()) {
      actorSet.add(act.actor.trim());
    }
  }
  return Array.from(actorSet).sort();
}

/**
 * Filters activity events by event type, actor, date range, and search query.
 */
export function filterActivities(
  activities: ActivityEvent[],
  filters: ActivityFilters,
  reviewsMap: Map<string, ReviewSubmission> = new Map(),
  referenceNow?: Date | null,
): ActivityEvent[] {
  const q = filters.searchQuery.trim().toLowerCase();

  return activities.filter((act) => {
    // 1. Event Type filter
    if (filters.eventType !== "all" && act.type !== filters.eventType) {
      return false;
    }

    // 2. Actor filter
    if (filters.actor !== "all" && act.actor !== filters.actor) {
      return false;
    }

    // 3. Date Range filter
    if (filters.dateRange !== "all") {
      const parsed = parseActivityDate(act.timestamp);
      if (filters.dateRange === "legacy") {
        if (parsed !== null) return false;
      } else if (!parsed) {
        // Exclude legacy unparseable events from specific time buckets
        return false;
      } else if (referenceNow) {
        const group = getActivityDateGroup(act.timestamp, referenceNow);
        if (filters.dateRange === "today" && group !== "Today") {
          return false;
        }

        const cutoffMs =
          filters.dateRange === "7d"
            ? 7 * 24 * 60 * 60 * 1000
            : filters.dateRange === "30d"
            ? 30 * 24 * 60 * 60 * 1000
            : null;

        if (cutoffMs !== null) {
          const earliestAllowed = referenceNow.getTime() - cutoffMs;
          if (parsed.getTime() < earliestAllowed) {
            return false;
          }
        }
      }
    }

    // 4. Search Query filter (matches actor, target, action, review title, event type)
    if (q) {
      const matchesActor = act.actor.toLowerCase().includes(q);
      const matchesTarget = act.target.toLowerCase().includes(q);
      const matchesAction = act.action.toLowerCase().includes(q);
      const matchesType = act.type.toLowerCase().includes(q);

      let matchesReviewTitle = false;
      if (act.reviewId) {
        const review = reviewsMap.get(act.reviewId);
        if (review) {
          matchesReviewTitle =
            review.title.toLowerCase().includes(q) ||
            review.guidelineCollection.toLowerCase().includes(q);
        }
      }

      if (!matchesActor && !matchesTarget && !matchesAction && !matchesType && !matchesReviewTitle) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Groups filtered activities into chronological groups: "Today", "Yesterday", "Older", "Legacy / Undated".
 */
export function groupActivitiesByDate(
  activities: ActivityEvent[],
  referenceNow?: Date | null,
): Array<{ group: ActivityDateGroup; items: ActivityEvent[] }> {
  const groups: Record<ActivityDateGroup, ActivityEvent[]> = {
    Today: [],
    Yesterday: [],
    Older: [],
    "Legacy / Undated": [],
  };

  const sorted = sortActivitiesChronologically(activities);

  for (const act of sorted) {
    const groupName = getActivityDateGroup(act.timestamp, referenceNow);
    groups[groupName].push(act);
  }

  const order: ActivityDateGroup[] = ["Today", "Yesterday", "Older", "Legacy / Undated"];

  return order
    .filter((groupName) => groups[groupName].length > 0)
    .map((groupName) => ({
      group: groupName,
      items: groups[groupName],
    }));
}
