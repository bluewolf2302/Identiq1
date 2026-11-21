import { LATEST_KNOWLEDGE_VERSION_ID } from "./knowledge-versions";
import type { KnowledgeVersionSnapshot, WorkspaceBrand } from "./types";

export function buildNewReviewHref(params?: {
  brandId?: string | null;
  brandVersionId?: string | null;
}): string {
  const search = new URLSearchParams();
  const cleanBrandId = params?.brandId?.trim();
  const cleanVersionId = params?.brandVersionId?.trim();

  if (cleanBrandId) {
    search.set("brandId", cleanBrandId);
  }
  if (
    cleanVersionId &&
    cleanVersionId !== LATEST_KNOWLEDGE_VERSION_ID
  ) {
    search.set("brandVersionId", cleanVersionId);
  }

  const query = search.toString();
  return query ? `/reviews/new?${query}` : "/reviews/new";
}

export function buildKnowledgeHubHref(params?: {
  brandId?: string | null;
  sourceDocId?: string | null;
  page?: number | null;
}): string {
  const search = new URLSearchParams();
  if (params?.brandId?.trim()) search.set("brandId", params.brandId.trim());
  if (params?.sourceDocId?.trim()) {
    search.set("sourceDocId", params.sourceDocId.trim());
  }
  if (params?.page && params.page > 0) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/knowledge-hub?${query}` : "/knowledge-hub";
}

export function resolveNewReviewBrandAndVersion(params: {
  requestedBrandId?: string | null;
  requestedVersionId?: string | null;
  chosenBrandId?: string | null;
  selectedBrandId?: string | null;
  workspaceBrands: WorkspaceBrand[];
  snapshots: KnowledgeVersionSnapshot[];
}): {
  activeBrandId: string;
  activeBrand: WorkspaceBrand | null;
  effectiveVersionId: string;
  queryBrandWarning: string | null;
  queryVersionWarning: string | null;
} {
  const cleanRequestedBrand = params.requestedBrandId?.trim() || "";
  const cleanRequestedVersion = params.requestedVersionId?.trim() || "";
  const cleanChosenBrand = params.chosenBrandId?.trim() || "";

  let queryBrandWarning: string | null = null;
  let activeBrandId = "";

  if (cleanChosenBrand) {
    activeBrandId = cleanChosenBrand;
  } else if (cleanRequestedBrand) {
    const matched = params.workspaceBrands.find(
      (b) => b.brandId === cleanRequestedBrand,
    );
    if (matched) {
      activeBrandId = matched.brandId;
    } else if (params.workspaceBrands.length > 0) {
      queryBrandWarning = `Requested brand "${cleanRequestedBrand}" was not found in this workspace. Showing "${params.workspaceBrands[0]!.brandName}" instead.`;
      activeBrandId =
        params.selectedBrandId || params.workspaceBrands[0]!.brandId;
    }
  } else {
    activeBrandId =
      params.selectedBrandId || params.workspaceBrands[0]?.brandId || "";
  }

  const activeBrand =
    params.workspaceBrands.find((b) => b.brandId === activeBrandId) ?? null;

  let effectiveVersionId = LATEST_KNOWLEDGE_VERSION_ID;
  let queryVersionWarning: string | null = null;

  if (
    cleanRequestedVersion &&
    cleanRequestedVersion !== LATEST_KNOWLEDGE_VERSION_ID
  ) {
    const snapshotExists = params.snapshots.some(
      (s) => s.versionId === cleanRequestedVersion && s.brandId === activeBrandId,
    );
    if (snapshotExists) {
      effectiveVersionId = cleanRequestedVersion;
    } else if (params.snapshots.length > 0 && activeBrandId) {
      queryVersionWarning = `Requested guideline version "${cleanRequestedVersion}" is not available for ${activeBrand?.brandName || "this brand"}. Using Latest Published rules.`;
    }
  }

  return {
    activeBrandId,
    activeBrand,
    effectiveVersionId,
    queryBrandWarning,
    queryVersionWarning,
  };
}
