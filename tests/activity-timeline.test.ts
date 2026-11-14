import assert from "node:assert/strict";
import test from "node:test";

import {
  filterActivities,
  formatActivityAbsoluteTime,
  formatActivityRelativeTime,
  getActivityDateGroup,
  getActivityTimeInfo,
  getUniqueActors,
  groupActivitiesByDate,
  isLegacyActivityTimestamp,
  parseActivityDate,
  sortActivitiesChronologically,
  type ActivityFilters,
} from "../lib/activity-timeline";
import { INITIAL_ACTIVITY, INITIAL_REVIEWS } from "../lib/seed-data";
import type { ActivityEvent, ReviewSubmission } from "../lib/types";

test("parseActivityDate strictly parses valid ISO 8601 strings and rejects legacy strings", () => {
  // Valid ISO 8601
  const isoDate = parseActivityDate("2026-11-14T10:30:00.000Z");
  assert.ok(isoDate instanceof Date);
  assert.equal(isoDate.getUTCFullYear(), 2026);
  assert.equal(isoDate.getUTCMonth(), 10); // Nov
  assert.equal(isoDate.getUTCDate(), 14);

  // ISO without millis
  const isoSimple = parseActivityDate("2026-11-14T10:30:00Z");
  assert.ok(isoSimple instanceof Date);

  // Legacy relative strings must be rejected as unstandardized
  assert.equal(parseActivityDate("12 mins ago"), null);
  assert.equal(parseActivityDate("1 hour ago"), null);
  assert.equal(parseActivityDate("Yesterday"), null);
  assert.equal(parseActivityDate("Nov 10, 2026"), null);
  assert.equal(parseActivityDate("Just now"), null);
  assert.equal(parseActivityDate(""), null);
  assert.equal(parseActivityDate(undefined), null);
});

test("isLegacyActivityTimestamp identifies legacy seed events", () => {
  assert.equal(isLegacyActivityTimestamp("12 mins ago"), true);
  assert.equal(isLegacyActivityTimestamp("Nov 10, 2026"), true);
  assert.equal(isLegacyActivityTimestamp("2026-11-14T10:30:00.000Z"), false);
});

test("formatActivityRelativeTime and formatActivityAbsoluteTime produce clear time descriptions", () => {
  const ref = new Date("2026-11-14T12:00:00.000Z");

  // Just now (< 45s)
  const justNow = new Date("2026-11-14T11:59:30.000Z");
  assert.equal(formatActivityRelativeTime(justNow, ref), "Just now");

  // Minutes ago
  const fiveMinAgo = new Date("2026-11-14T11:55:00.000Z");
  assert.equal(formatActivityRelativeTime(fiveMinAgo, ref), "5 mins ago");

  // Hours ago
  const twoHoursAgo = new Date("2026-11-14T10:00:00.000Z");
  assert.equal(formatActivityRelativeTime(twoHoursAgo, ref), "2 hours ago");

  // Absolute formatting
  const formattedAbs = formatActivityAbsoluteTime(new Date("2026-11-14T10:30:00.000Z"));
  assert.ok(formattedAbs.includes("Nov 14, 2026"));
});

test("getActivityDateGroup categorizes ISO dates and separates legacy records", () => {
  const ref = new Date("2026-11-14T12:00:00.000Z");

  // Today
  assert.equal(getActivityDateGroup("2026-11-14T08:00:00.000Z", ref), "Today");

  // Yesterday
  assert.equal(getActivityDateGroup("2026-11-13T15:00:00.000Z", ref), "Yesterday");

  // Older
  assert.equal(getActivityDateGroup("2026-11-05T10:00:00.000Z", ref), "Older");

  // Legacy
  assert.equal(getActivityDateGroup("12 mins ago", ref), "Legacy / Undated");
  assert.equal(getActivityDateGroup("Nov 10, 2026", ref), "Legacy / Undated");
});

test("getActivityTimeInfo gives rich metadata for ISO and legacy events", () => {
  const ref = new Date("2026-11-14T12:00:00.000Z");

  const isoInfo = getActivityTimeInfo("2026-11-14T11:50:00.000Z", ref);
  assert.equal(isoInfo.isLegacy, false);
  assert.equal(isoInfo.display, "10 mins ago");
  assert.ok(isoInfo.absolute !== undefined);
  assert.equal(isoInfo.dateGroup, "Today");

  const legacyInfo = getActivityTimeInfo("Yesterday", ref);
  assert.equal(legacyInfo.isLegacy, true);
  assert.equal(legacyInfo.display, "Yesterday");
  assert.equal(legacyInfo.absolute, undefined);
  assert.equal(legacyInfo.dateGroup, "Legacy / Undated");
});

test("sortActivitiesChronologically puts ISO events first ordered newest to oldest", () => {
  const events: ActivityEvent[] = [
    {
      id: "act-legacy-1",
      actor: "Maya Lin",
      action: "commented",
      target: "Doc",
      timestamp: "12 mins ago",
      type: "changes_requested",
    },
    {
      id: "act-new-1",
      actor: "Elena Vance",
      action: "submitted",
      target: "Doc",
      timestamp: "2026-11-14T10:00:00.000Z",
      type: "submitted",
    },
    {
      id: "act-new-2",
      actor: "Elena Vance",
      action: "approved",
      target: "Doc",
      timestamp: "2026-11-14T11:00:00.000Z",
      type: "approved",
    },
    {
      id: "act-legacy-2",
      actor: "Marcus Thorne",
      action: "uploaded",
      target: "Doc",
      timestamp: "Yesterday",
      type: "asset_uploaded",
    },
  ];

  const sorted = sortActivitiesChronologically(events);
  // act-new-2 (11:00) should be first, then act-new-1 (10:00), followed by legacy events
  assert.equal(sorted[0].id, "act-new-2");
  assert.equal(sorted[1].id, "act-new-1");
  assert.equal(sorted[2].id, "act-legacy-2");
  assert.equal(sorted[3].id, "act-legacy-1");
});

test("getUniqueActors returns unique sorted actor list", () => {
  const actors = getUniqueActors(INITIAL_ACTIVITY);
  assert.ok(actors.includes("Maya Lin"));
  assert.ok(actors.includes("Elena Vance"));
  assert.ok(actors.includes("Marcus Thorne"));
  assert.ok(actors.includes("Partner Legal"));
  assert.equal(actors.length, 4);
});

test("filterActivities filters by event type", () => {
  const filters: ActivityFilters = {
    eventType: "submitted",
    actor: "all",
    dateRange: "all",
    searchQuery: "",
  };

  const filtered = filterActivities(INITIAL_ACTIVITY, filters);
  // act-2 and act-3 are "submitted"
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((a) => a.type === "submitted"));
});

test("filterActivities filters by actor", () => {
  const filters: ActivityFilters = {
    eventType: "all",
    actor: "Maya Lin",
    dateRange: "all",
    searchQuery: "",
  };

  const filtered = filterActivities(INITIAL_ACTIVITY, filters);
  // act-1 and act-4 are by "Maya Lin"
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((a) => a.actor === "Maya Lin"));
});

test("filterActivities filters by date range distinguishing ISO vs legacy", () => {
  const ref = new Date("2026-11-14T12:00:00.000Z");
  const mixedEvents: ActivityEvent[] = [
    {
      id: "act-live-today",
      actor: "Maya Lin",
      action: "approved",
      target: "Doc",
      timestamp: "2026-11-14T09:00:00.000Z",
      type: "approved",
    },
    {
      id: "act-live-older",
      actor: "Maya Lin",
      action: "submitted",
      target: "Doc",
      timestamp: "2026-10-01T09:00:00.000Z",
      type: "submitted",
    },
    ...INITIAL_ACTIVITY,
  ];

  // Date range "today": only act-live-today should match
  const filtersToday: ActivityFilters = {
    eventType: "all",
    actor: "all",
    dateRange: "today",
    searchQuery: "",
  };
  const filteredToday = filterActivities(mixedEvents, filtersToday, new Map(), ref);
  assert.equal(filteredToday.length, 1);
  assert.equal(filteredToday[0].id, "act-live-today");

  // Date range "legacy": only INITIAL_ACTIVITY (5 events) should match
  const filtersLegacy: ActivityFilters = {
    eventType: "all",
    actor: "all",
    dateRange: "legacy",
    searchQuery: "",
  };
  const filteredLegacy = filterActivities(mixedEvents, filtersLegacy, new Map(), ref);
  assert.equal(filteredLegacy.length, 5);
});

test("filterActivities searches actor, action, target and review title", () => {
  const reviewsMap = new Map<string, ReviewSubmission>(
    INITIAL_REVIEWS.map((r) => [r.id, r]),
  );

  // Search by target text
  const searchSerum: ActivityFilters = {
    eventType: "all",
    actor: "all",
    dateRange: "all",
    searchQuery: "Solstice Autumn",
  };
  assert.equal(filterActivities(INITIAL_ACTIVITY, searchSerum, reviewsMap).length, 2);

  // Search by action text
  const searchAction: ActivityFilters = {
    eventType: "all",
    actor: "all",
    dateRange: "all",
    searchQuery: "production specification",
  };
  assert.equal(filterActivities(INITIAL_ACTIVITY, searchAction, reviewsMap).length, 1);

  // Search by actor
  const searchActor: ActivityFilters = {
    eventType: "all",
    actor: "all",
    dateRange: "all",
    searchQuery: "Elena",
  };
  assert.equal(filterActivities(INITIAL_ACTIVITY, searchActor, reviewsMap).length, 1);
});

test("groupActivitiesByDate and empty collections handle safely", () => {
  const empty = filterActivities([], {
    eventType: "all",
    actor: "all",
    dateRange: "all",
    searchQuery: "",
  });
  assert.equal(empty.length, 0);

  const emptyGroups = groupActivitiesByDate([]);
  assert.equal(emptyGroups.length, 0);

  const groups = groupActivitiesByDate(INITIAL_ACTIVITY);
  // All seed activities are legacy
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group, "Legacy / Undated");
  assert.equal(groups[0].items.length, 5);
});
