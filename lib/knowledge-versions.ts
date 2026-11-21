import type {
  KnowledgeEntry,
  KnowledgeSection,
  KnowledgeVersionSnapshot,
  PublicationStatus,
} from "./types";

export const LATEST_KNOWLEDGE_VERSION_ID = "latest";

export type KnowledgeStatusFilter = "All" | "Published" | "Draft" | "Archived";

export function getEntryPublicationStatus(
  entry: KnowledgeEntry,
): PublicationStatus {
  if (entry.publicationStatus) {
    return entry.publicationStatus;
  }
  if (entry.status === "Approved") return "published";
  if (entry.status === "Archived") return "archived";
  return "draft";
}

export function deriveKnowledgeCounts(entries: KnowledgeEntry[]): {
  total: number;
  published: number;
  draft: number;
  archived: number;
} {
  let published = 0;
  let draft = 0;
  let archived = 0;
  for (const entry of entries) {
    const status = getEntryPublicationStatus(entry);
    if (status === "published") published += 1;
    else if (status === "archived") archived += 1;
    else draft += 1;
  }
  return {
    total: entries.length,
    published,
    draft,
    archived,
  };
}

export function resolveVersionSnapshot(
  snapshots: KnowledgeVersionSnapshot[],
  selectedVersionId: string | null | undefined,
): KnowledgeVersionSnapshot | null {
  if (!selectedVersionId || selectedVersionId === LATEST_KNOWLEDGE_VERSION_ID) {
    return null;
  }
  return snapshots.find((s) => s.versionId === selectedVersionId) ?? null;
}

export function resolveDisplayedKnowledgeEntries(params: {
  liveEntries: KnowledgeEntry[];
  snapshots: KnowledgeVersionSnapshot[];
  selectedVersionId: string;
}): {
  entries: KnowledgeEntry[];
  activeSnapshot: KnowledgeVersionSnapshot | null;
  isHistoricalView: boolean;
} {
  const snapshot = resolveVersionSnapshot(
    params.snapshots,
    params.selectedVersionId,
  );
  if (!snapshot) {
    return {
      entries: params.liveEntries,
      activeSnapshot: null,
      isHistoricalView: false,
    };
  }

  return {
    entries: Array.isArray(snapshot.entries) ? snapshot.entries : [],
    activeSnapshot: snapshot,
    isHistoricalView: true,
  };
}

export function filterKnowledgeEntries(params: {
  entries: KnowledgeEntry[];
  activeSection: KnowledgeSection;
  statusFilter: KnowledgeStatusFilter;
  searchQuery: string;
  sourceDocFilter?: string;
  sourcePageFilter?: number | null;
  isHistoricalView?: boolean;
}): KnowledgeEntry[] {
  const q = params.searchQuery.trim().toLowerCase();
  return params.entries.filter((entry) => {
    if (params.sourceDocFilter) {
      const matchesDoc = entry.sourceDocumentId === params.sourceDocFilter;
      const matchesPage =
        params.sourcePageFilter == null ||
        entry.pageNumber === params.sourcePageFilter;
      if (!matchesDoc || !matchesPage) return false;
    } else if (entry.section !== params.activeSection) {
      return false;
    }

    if (!params.isHistoricalView && params.statusFilter !== "All") {
      const pubStatus = getEntryPublicationStatus(entry);
      if (params.statusFilter === "Published" && pubStatus !== "published") {
        return false;
      }
      if (params.statusFilter === "Draft" && pubStatus !== "draft") {
        return false;
      }
      if (params.statusFilter === "Archived" && pubStatus !== "archived") {
        return false;
      }
    }

    if (!q) return true;

    return (
      entry.title.toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q) ||
      (entry.preferredTerm || "").toLowerCase().includes(q) ||
      (entry.avoidTerm || "").toLowerCase().includes(q) ||
      (entry.sourceTitle || "").toLowerCase().includes(q) ||
      (entry.sourceDocumentId || "").toLowerCase().includes(q)
    );
  });
}

export function countEntriesBySection(
  entries: KnowledgeEntry[],
): Record<KnowledgeSection, number> {
  const counts: Record<KnowledgeSection, number> = {
    guidelines: 0,
    facts: 0,
    terminology: 0,
    prohibited: 0,
    voice: 0,
    visual: 0,
    policies: 0,
  };
  for (const entry of entries) {
    if (entry.section in counts) {
      counts[entry.section] += 1;
    }
  }
  return counts;
}
