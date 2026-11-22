"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {
  ActivityEvent,
  BrandAsset,
  KnowledgeEntry,
  KnowledgeSection,
  KnowledgeVersionSnapshot,
  ReviewFinding,
  ReviewStatus,
  ReviewSubmission,
  WorkspaceBrand,
} from "@/lib/types";
import type {
  BrandVersionSnapshot as ContextBrandVersionSnapshot,
  ManagedKnowledgeEntry,
  WorkspaceBrandRecord,
} from "@/lib/brand-context/types";
import type { ReviewDecision } from "@/lib/contracts/workflow";
import {
  buildFindingDecisionPatch,
  getFindingDecisionValidationError,
} from "@/lib/review-decisions";
import {
  INITIAL_ACTIVITY,
  INITIAL_REVIEWS,
} from "@/lib/seed-data";
import {
  DemoPersona,
  resolveDemoPersonaConfig,
  TERALUNE_CURATED_DEMO_ASSETS,
  TERALUNE_DEMO_BRAND_ID,
} from "@/lib/demo/teralune-demo-fixtures";
import {
  PersistenceMode,
  callPostgrest,
  getClientAuthToken,
  getSupabaseIntegrationStatus,
  setClientAuthToken,
  getDemoModePreference,
  setDemoModePreference,
} from "@/lib/supabase/client";
import {
  SupabaseUser,
  SupabaseSession,
  signInWithPassword,
  signUp as authSignUp,
  signOut as authSignOut,
  restoreSession,
  onAuthStateChange,
} from "@/lib/supabase/auth";
import {
  ReviewRepository,
  LocalReviewRepository,
  SupabaseReviewRepository,
  ActivityRepository,
  LocalActivityRepository,
  SupabaseActivityRepository,
  DemoReviewRepository,
  DemoActivityRepository,
} from "@/lib/repositories";
import { CheckCircle2, Info, X, ShieldAlert } from "lucide-react";
import {
  createDefaultViewerProfile,
  DEFAULT_VIEWER_ROLE,
  FALLBACK_VIEWER_NAME,
  loadViewerProfile,
  normalizeViewerRole,
  PresetAvatarId,
  resolveActiveActorIdentity,
  saveViewerProfile,
  validateViewerName,
  ViewerProfile,
} from "@/lib/viewer-profile";
import { DEMO_CONFIG } from "@/lib/demo/config";
import { getAssetPersistenceNotice } from "@/lib/asset-validation";
import { LATEST_KNOWLEDGE_VERSION_ID } from "@/lib/knowledge-versions";

interface ToastMessage {
  id: string;
  text: string;
  tone: "success" | "info" | "error";
}

interface WorkspaceSettings {
  reviewerName: string;
  reviewerRole: string;
  autoFlagUnverified: boolean;
  strictClaimsMode: boolean;
  minimumApprovalScore: number;
}

export interface UserOrganisationMembership {
  organisation_id: string;
  role: string;
  name?: string;
}

export interface IdentiqContextValue {
  hydrated: boolean;
  reviews: ReviewSubmission[];
  knowledge: KnowledgeEntry[];
  workspaceBrands: WorkspaceBrand[];
  selectedBrandId: string | null;
  selectedBrand: WorkspaceBrand | null;
  selectedBrandVersionId: string;
  versionSnapshots: KnowledgeVersionSnapshot[];
  knowledgeLoading: boolean;
  knowledgeMutating: boolean;
  knowledgeError: string | null;
  assets: BrandAsset[];
  activities: ActivityEvent[];
  settings: WorkspaceSettings;
  activeReviewId: string;
  persistenceMode: PersistenceMode;
  isPersisted: boolean;
  isSyncing: boolean;
  organisationId: string | null;
  brandId: string | null;
  brandName: string | null;
  user: SupabaseUser | null;
  session: SupabaseSession | null;
  userRole: string | null;
  userOrganisations: UserOrganisationMembership[];
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  createOrganisation: (name: string) => Promise<{ success: boolean; orgId?: string; error?: string }>;
  switchOrganisation: (orgId: string) => Promise<void>;
  setAuthContext: (token: string | null, orgId: string | null) => void;
  reloadFromPersistence: () => Promise<void>;
  refreshBrands: (overrideOrgId?: string) => Promise<void>;
  selectBrand: (targetBrandId: string) => Promise<void>;
  selectBrandVersion: (versionId: string) => void;
  createWorkspaceBrand: (input: {
    brandName: string;
    description?: string;
    website?: string;
    profileSummary?: string;
    voiceAndToneSummary?: string;
  }) => Promise<WorkspaceBrand>;
  saveKnowledgeEntry: (input: {
    id?: string;
    brandId?: string;
    section: KnowledgeSection;
    title: string;
    content: string;
    preferredTerm?: string;
    avoidTerm?: string;
    hexCodes?: string[];
    fontFamily?: string;
    supportingEvidence?: string;
    restrictions?: string[];
    severity?: "high" | "medium" | "low";
    sourceDocumentId?: string;
    sourceTitle?: string;
    sourceDocumentVersion?: string;
    sectionRef?: string;
    pageNumber?: number;
    versionId?: string;
    publishImmediately?: boolean;
  }) => Promise<KnowledgeEntry>;
  publishKnowledgeEntry: (entryId: string, note?: string) => Promise<KnowledgeEntry>;
  archiveKnowledgeEntry: (entryId: string) => Promise<KnowledgeEntry>;
  getKnowledgeRequestContext: () => {
    organisationId: string;
    headers: Record<string, string>;
  };
  reloadSelectedBrandKnowledge: () => Promise<void>;
  setActiveReviewId: (id: string) => void;
  addReview: (review: ReviewSubmission, brandId?: string) => Promise<void>;
  updateReviewStatus: (
    reviewId: string,
    status: ReviewStatus,
    reviewerNotes?: string
  ) => Promise<void>;
  toggleFindingResolved: (reviewId: string, findingId: string) => Promise<void>;
  updateFindingCorrection: (
    reviewId: string,
    findingId: string,
    editedText: string,
    applyToCopy?: boolean
  ) => Promise<void>;
  addFindingComment: (reviewId: string, findingId: string, text: string) => Promise<void>;
  updateFindingDecision: (
    reviewId: string,
    findingId: string,
    decision: ReviewDecision,
    reason?: string
  ) => Promise<void>;
  addManualFinding: (reviewId: string, finding: ReviewFinding, brandRuleId?: string) => Promise<void>;
  upsertKnowledgeEntry: (entry: KnowledgeEntry) => void;
  deleteKnowledgeEntry: (id: string) => void;
  toggleKnowledgeStatus: (id: string) => void;
  addAsset: (asset: BrandAsset) => void;
  deleteAsset: (id: string) => void;
  updateSettings: (next: Partial<WorkspaceSettings>) => void;
  resetDemoWorkspace: () => void;
  enterSharedDemoMode: () => Promise<void>;
  enterLocalDemoMode: () => void;
  enterTeraluneDemo: (options?: { persona?: DemoPersona }) => Promise<void>;
  isDemoWorkspace: boolean;
  demoPersona: DemoPersona;
  setDemoPersona: (persona: DemoPersona) => void;
  notify: (text: string, tone?: "success" | "info" | "error") => void;
  viewerProfile: ViewerProfile;
  profileHydrated: boolean;
  guidedTourOpen: boolean;
  setGuidedTourOpen: (open: boolean) => void;
  completeOnboarding: (input: {
    name: string;
    role?: string;
    avatarId: PresetAvatarId;
    customAvatarDataUrl?: string;
    startTour?: boolean;
  }) => { success: boolean; error?: string };
  updateViewerProfile: (patch: {
    name?: string;
    role?: string;
    avatarId?: PresetAvatarId;
    customAvatarDataUrl?: string | null;
  }) => { success: boolean; error?: string };
  markGuidedTourCompleted: () => void;
  replayGuidedTour: () => void;
}

export const STORAGE_KEY = "identiq_workspace_v2";
export const ORG_STORAGE_KEY = "identiq_org_id";
export const BRAND_STORAGE_KEY = "identiq_brand_id";
export const DEMO_PERSONA_STORAGE_KEY = "identiq_demo_persona_v1";

export interface BrandLookupResult {
  id: string;
  name: string;
}

export interface BrandTenancyState {
  organisationId: string | null;
  brandId: string | null;
  brandName: string | null;
  userRole: string | null;
}

export interface BrandStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SwitchOrgResult =
  | { success: true; orgId: string; brandId: string; brandName: string }
  | { success: false; reason: "NOT_A_MEMBER" | "STALE" | "NO_BRAND" | "ERROR"; error?: unknown };

export type ResolveBrandResult =
  | { success: true; brandId: string; brandName: string }
  | { success: false; reason: "STALE" | "NO_BRAND" | "ERROR"; error?: unknown };

/**
 * Production coordinator managing organisation and brand tenant isolation,
 * request-generation sequence protection against stale asynchronous responses,
 * and fail-closed review submission rules.
 */
export class BrandTenancyManager {
  private generation = 0;
  private state: BrandTenancyState;
  private storage: BrandStorageAdapter;
  private onStateChange?: (state: BrandTenancyState) => void;
  private onNotify?: (message: string, tone: "success" | "info" | "error") => void;

  public static readonly ORG_STORAGE_KEY = "identiq_org_id";
  public static readonly BRAND_STORAGE_KEY = "identiq_brand_id";

  constructor(options: {
    initialState?: Partial<BrandTenancyState>;
    storage?: BrandStorageAdapter;
    onStateChange?: (state: BrandTenancyState) => void;
    onNotify?: (message: string, tone: "success" | "info" | "error") => void;
  } = {}) {
    this.state = {
      organisationId: options.initialState?.organisationId ?? null,
      brandId: options.initialState?.brandId ?? null,
      brandName: options.initialState?.brandName ?? null,
      userRole: options.initialState?.userRole ?? null,
    };
    this.storage =
      options.storage ??
      (typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : typeof localStorage !== "undefined"
        ? localStorage
        : {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          });
    this.onStateChange = options.onStateChange;
    this.onNotify = options.onNotify;
  }

  get organisationId(): string | null {
    return this.state.organisationId;
  }

  get brandId(): string | null {
    return this.state.brandId;
  }

  get brandName(): string | null {
    return this.state.brandName;
  }

  get userRole(): string | null {
    return this.state.userRole;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  getState(): BrandTenancyState {
    return { ...this.state };
  }

  notify(message: string, tone: "success" | "info" | "error" = "info"): void {
    if (this.onNotify) {
      this.onNotify(message, tone);
    }
  }

  setCallbacks(callbacks: {
    onStateChange?: (state: BrandTenancyState) => void;
    onNotify?: (message: string, tone: "success" | "info" | "error") => void;
  }): void {
    this.onStateChange = callbacks.onStateChange;
    this.onNotify = callbacks.onNotify;
  }

  updateState(patch: Partial<BrandTenancyState>): void {
    this.state = { ...this.state, ...patch };
    if (this.onStateChange) {
      this.onStateChange({ ...this.state });
    }
  }

  /**
   * Immediately invalidates earlier in-flight brand lookups so any delayed
   * completion or error cannot overwrite the active organisation or brand.
   */
  invalidateInFlightRequests(): number {
    this.generation += 1;
    return this.generation;
  }

  /**
   * Switches organisation with generation tracking.
   * Invalidates earlier in-flight requests, purges active brand state,
   * queries the primary brand, and emits "Switched organisation" ONLY if brand lookup succeeds.
   */
  async switchOrganisation(params: {
    targetOrgId: string;
    userOrganisations: Array<{ organisation_id: string; role: string; name?: string }>;
    fetchBrand: (orgId: string) => Promise<BrandLookupResult | null>;
  }): Promise<SwitchOrgResult> {
    const match = params.userOrganisations.find((o) => o.organisation_id === params.targetOrgId);
    if (!match) {
      this.notify("You are not a member of that organisation", "error");
      return { success: false, reason: "NOT_A_MEMBER" };
    }

    // 1. Immediately invalidate earlier in-flight requests
    const requestId = this.invalidateInFlightRequests();

    // 2. Clear old brand state immediately to prevent cross-tenant contamination
    this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
    this.storage.setItem(BrandTenancyManager.ORG_STORAGE_KEY, params.targetOrgId);
    this.updateState({
      organisationId: params.targetOrgId,
      userRole: match.role,
      brandId: null,
      brandName: null,
    });

    try {
      const brand = await params.fetchBrand(params.targetOrgId);

      // Check if stale request
      if (this.generation !== requestId) {
        return { success: false, reason: "STALE" };
      }

      if (brand) {
        this.storage.setItem(BrandTenancyManager.BRAND_STORAGE_KEY, brand.id);
        this.updateState({
          brandId: brand.id,
          brandName: brand.name,
        });
        this.notify("Switched organisation", "success");
        return {
          success: true,
          orgId: params.targetOrgId,
          brandId: brand.id,
          brandName: brand.name,
        };
      } else {
        // No brand configured: fail closed without emitting success notification
        this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
        this.updateState({
          brandId: null,
          brandName: null,
        });
        this.notify("Selected organisation has no configured brand profile", "info");
        return { success: false, reason: "NO_BRAND" };
      }
    } catch (err: unknown) {
      // Check if stale request
      if (this.generation !== requestId) {
        return { success: false, reason: "STALE" };
      }

      this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
      this.updateState({
        brandId: null,
        brandName: null,
      });
      this.notify(
        err instanceof Error ? err.message : "Failed to load organisation brand profile",
        "error"
      );
      return { success: false, reason: "ERROR", error: err };
    }
  }

  /**
   * Asynchronously resolves the primary brand for an organisation during
   * session restoration, sign-in, or sign-up. Protected by generation counter.
   */
  async resolveBrandForOrganisation(params: {
    orgId: string;
    fetchBrand: (orgId: string) => Promise<BrandLookupResult | null>;
  }): Promise<ResolveBrandResult> {
    const requestId = this.invalidateInFlightRequests();

    try {
      const brand = await params.fetchBrand(params.orgId);

      if (this.generation !== requestId) {
        return { success: false, reason: "STALE" };
      }

      if (brand) {
        this.storage.setItem(BrandTenancyManager.BRAND_STORAGE_KEY, brand.id);
        this.updateState({
          brandId: brand.id,
          brandName: brand.name,
        });
        return { success: true, brandId: brand.id, brandName: brand.name };
      } else {
        this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
        this.updateState({
          brandId: null,
          brandName: null,
        });
        return { success: false, reason: "NO_BRAND" };
      }
    } catch (err: unknown) {
      if (this.generation !== requestId) {
        return { success: false, reason: "STALE" };
      }

      this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
      this.updateState({
        brandId: null,
        brandName: null,
      });
      return { success: false, reason: "ERROR", error: err };
    }
  }

  /**
   * Sets active state when an organisation is newly created via RPC.
   * Invalidates earlier in-flight requests.
   */
  handleOrganisationCreated(params: {
    organisationId: string;
    brandId: string;
    brandName?: string | null;
    role?: string;
  }): void {
    this.invalidateInFlightRequests();
    this.storage.setItem(BrandTenancyManager.ORG_STORAGE_KEY, params.organisationId);
    this.storage.setItem(BrandTenancyManager.BRAND_STORAGE_KEY, params.brandId);
    this.updateState({
      organisationId: params.organisationId,
      brandId: params.brandId,
      brandName: params.brandName ?? null,
      userRole: params.role ?? "owner",
    });
  }

  /**
   * Checks whether a request generation and target organisation ID are still active.
   * Protects organisation-scoped asynchronous operations (e.g. data fetching) from
   * applying state after user switched organisations or a newer request started.
   */
  isCurrent(expectedGen: number, expectedOrgId?: string | null): boolean {
    if (this.generation !== expectedGen) {
      return false;
    }
    if (expectedOrgId !== undefined && this.state.organisationId !== expectedOrgId) {
      return false;
    }
    return true;
  }

  /**
   * Resets active tenancy and brand state on sign-out or switching to demo mode.
   * Invalidates earlier in-flight requests.
   */
  reset(): void {
    this.invalidateInFlightRequests();
    this.storage.removeItem(BrandTenancyManager.ORG_STORAGE_KEY);
    this.storage.removeItem(BrandTenancyManager.BRAND_STORAGE_KEY);
    this.updateState({
      organisationId: null,
      brandId: null,
      brandName: null,
      userRole: null,
    });
  }

  /**
   * Validates tenancy for review submission.
   * Strictly enforces that authenticated submissions have an active organisation
   * and resolved brand profile, and never fall back to demo IDs.
   */
  validateReviewSubmissionTenancy(params: {
    persistenceMode: PersistenceMode;
    explicitBrandId?: string;
  }): { organisationId: string; brandId: string } {
    if (params.persistenceMode === "AUTHENTICATED_SUPABASE") {
      if (!this.state.organisationId) {
        const errorMsg = "Active organisation is required to submit reviews in authenticated mode.";
        this.notify(errorMsg, "error");
        throw new Error(errorMsg);
      }
      if (!this.state.brandId) {
        const errorMsg = "Active brand profile is required to submit reviews in authenticated mode.";
        this.notify(errorMsg, "error");
        throw new Error(errorMsg);
      }
      if (params.explicitBrandId && params.explicitBrandId !== this.state.brandId) {
        const errorMsg = "Caller-supplied brand ID does not match the active organisation's brand.";
        this.notify(errorMsg, "error");
        throw new Error(errorMsg);
      }
      return {
        organisationId: this.state.organisationId,
        brandId: this.state.brandId,
      };
    }

    if (params.persistenceMode === "SHARED_DEMO") {
      return {
        organisationId: DEMO_CONFIG.ORGANISATION_ID,
        brandId: DEMO_CONFIG.BRAND_ID,
      };
    }

    return {
      organisationId: "local-org",
      brandId: "local-brand",
    };
  }
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  reviewerName: FALLBACK_VIEWER_NAME,
  reviewerRole: DEFAULT_VIEWER_ROLE,
  autoFlagUnverified: true,
  strictClaimsMode: true,
  minimumApprovalScore: 85,
};

const IdentiqContext = createContext<IdentiqContextValue | null>(null);

function mapManagedEntryToUiEntry(entry: ManagedKnowledgeEntry): KnowledgeEntry {
  return {
    id: entry.id,
    brandId: entry.brandId,
    organisationId: entry.organisationId,
    section: entry.section,
    kind: entry.kind,
    title: entry.title,
    content: entry.content,
    entryOrigin: entry.entryOrigin,
    extractedText: entry.extractedText,
    sourceProposalId: entry.sourceProposalId,
    structuredFacts: entry.structuredFacts,
    preferredTerm: entry.preferredTerm,
    avoidTerm: entry.avoidTerm,
    hexCodes: entry.hexCodes,
    fontFamily: entry.fontFamily,
    supportingEvidence: entry.supportingEvidence,
    restrictions: entry.restrictions,
    severity: entry.severity,
    status:
      entry.publicationStatus === "published"
        ? "Approved"
        : entry.publicationStatus === "archived"
        ? "Archived"
        : "Pending Review",
    publicationStatus: entry.publicationStatus,
    versionNumber: entry.versionNumber,
    versionId: entry.versionId,
    sourceDocumentId: entry.sourceDocumentId,
    sourceTitle: entry.sourceTitle,
    sourceDocumentVersion: entry.sourceDocumentVersion,
    sectionRef: entry.sectionRef,
    pageNumber: entry.pageNumber,
    createdAt: entry.createdAt,
    publishedAt: entry.publishedAt,
    archivedAt: entry.archivedAt,
    updatedAt: entry.updatedAt.split("T")[0] || entry.updatedAt,
    owner: entry.owner,
  };
}

function mapSnapshotToUiSnapshot(
  snap: ContextBrandVersionSnapshot
): KnowledgeVersionSnapshot {
  const mappedEntries = Array.isArray(snap.entries)
    ? snap.entries.map(mapManagedEntryToUiEntry)
    : [];
  return {
    snapshotId: snap.snapshotId,
    brandId: snap.brandId,
    organisationId: snap.organisationId,
    versionId: snap.versionId,
    versionNumber: snap.versionNumber,
    publishedAt: snap.publishedAt,
    publishedBy: snap.publishedBy,
    entryCount: mappedEntries.length,
    note: snap.note,
    entries: mappedEntries,
  };
}

function mapBrandRecordToWorkspaceBrand(
  brand: WorkspaceBrandRecord
): WorkspaceBrand {
  return {
    brandId: brand.brandId,
    organisationId: brand.organisationId,
    brandName: brand.brandName,
    description: brand.description,
    website: brand.website,
    approved: brand.approved,
    isSample: brand.isSample,
    latestPublishedVersion: brand.latestPublishedVersion,
    publishedEntryCount: brand.publishedEntryCount,
    draftEntryCount: brand.draftEntryCount,
    archivedEntryCount: brand.archivedEntryCount,
    updatedAt: brand.updatedAt,
  };
}

export function IdentiqProvider({ children }: { children: React.ReactNode }) {
  const [reviews, setReviews] = useState<ReviewSubmission[]>(INITIAL_REVIEWS);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [workspaceBrands, setWorkspaceBrands] = useState<WorkspaceBrand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [selectedBrandVersionId, setSelectedBrandVersionId] = useState<string>(
    LATEST_KNOWLEDGE_VERSION_ID
  );
  const [versionSnapshots, setVersionSnapshots] = useState<KnowledgeVersionSnapshot[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeMutating, setKnowledgeMutating] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const knowledgeReqGenRef = useRef(0);
  const knowledgeAbortRef = useRef<AbortController | null>(null);
  const brandsReqGenRef = useRef(0);
  const brandsAbortRef = useRef<AbortController | null>(null);
  const selectedBrandIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedBrandIdRef.current = selectedBrandId;
  }, [selectedBrandId]);
  const [assets, setAssets] = useState<BrandAsset[]>(TERALUNE_CURATED_DEMO_ASSETS);
  const [demoPersona, setDemoPersonaState] = useState<DemoPersona>("Brand Manager");
  const [activities, setActivities] = useState<ActivityEvent[]>(INITIAL_ACTIVITY);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [activeReviewId, setActiveReviewId] = useState<string>(INITIAL_REVIEWS[0].id);
  const [hydrated, setHydrated] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Viewer onboarding & guided tour state (separate from Supabase auth/org profile)
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile>(() =>
    createDefaultViewerProfile()
  );
  const [profileHydrated, setProfileHydrated] = useState(false);
  const [guidedTourOpen, setGuidedTourOpen] = useState(false);

  // Multi-mode persistence & Auth state
  const [organisationId, setOrganisationId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrganisations, setUserOrganisations] = useState<UserOrganisationMembership[]>([]);
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("DEMO_LOCAL");
  const [isSyncing, setIsSyncing] = useState(false);
  const syncCountRef = useRef(0);

  const startSync = useCallback(() => {
    syncCountRef.current += 1;
    setIsSyncing(true);
  }, []);

  const endSync = useCallback(() => {
    syncCountRef.current = Math.max(0, syncCountRef.current - 1);
    if (syncCountRef.current === 0) {
      setIsSyncing(false);
    }
  }, []);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<SupabaseSession | null>(null);

  // Repositories
  const [reviewRepo, setReviewRepo] = useState<ReviewRepository>(() => new LocalReviewRepository(INITIAL_REVIEWS));
  const [activityRepo, setActivityRepo] = useState<ActivityRepository>(() => new LocalActivityRepository(INITIAL_ACTIVITY));

  const notify = useCallback((text: string, tone: "success" | "info" | "error" = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const [tenancyManager] = useState(() => new BrandTenancyManager());

  useEffect(() => {
    tenancyManager.setCallbacks({
      onStateChange: (next) => {
        setOrganisationId(next.organisationId);
        setBrandId(next.brandId);
        setBrandName(next.brandName);
        setUserRole(next.userRole);
      },
      onNotify: (msg, tone) => {
        notify(msg, tone);
      },
    });
  }, [tenancyManager, notify]);

  // Update repository instances when mode changes
  const updatePersistenceStatus = useCallback(
    (hasSession: boolean, hasOrg: boolean, isSharedDemo?: boolean) => {
      const status = getSupabaseIntegrationStatus(hasSession, hasOrg, isSharedDemo);
      setPersistenceMode(status.mode);

      if (status.mode === "AUTHENTICATED_SUPABASE") {
        setReviewRepo(new SupabaseReviewRepository());
        setActivityRepo(new SupabaseActivityRepository());
      } else if (status.mode === "SHARED_DEMO") {
        setReviewRepo(new DemoReviewRepository());
        setActivityRepo(new DemoActivityRepository());
      } else {
        setReviewRepo(new LocalReviewRepository(INITIAL_REVIEWS));
        setActivityRepo(new LocalActivityRepository(INITIAL_ACTIVITY));
      }
    },
    []
  );

  // Fetch organisation memberships from PostgREST with RLS
  const fetchMemberships = useCallback(async (token?: string) => {
    const res = await callPostgrest<UserOrganisationMembership[]>(
      "/rest/v1/organisation_members?select=organisation_id,role",
      { authToken: token }
    );
    return res.data || [];
  }, []);

  // Fetch primary brand scoped to organisation from PostgREST with RLS
  const fetchPrimaryBrand = useCallback(
    async (orgId: string, token?: string): Promise<{ id: string; name: string } | null> => {
      if (!orgId) return null;
      const res = await callPostgrest<Array<{ id: string; name: string }>>(
        `/rest/v1/brands?organisation_id=eq.${encodeURIComponent(orgId)}&select=id,name,approved,created_at&order=approved.desc,created_at.asc&limit=1`,
        { authToken: token }
      );

      if (res.error) {
        throw new Error(res.error.message || `Failed to fetch brand for organisation ${orgId}`);
      }

      if (!res.data || res.data.length === 0) {
        return null;
      }

      return {
        id: res.data[0].id,
        name: res.data[0].name,
      };
    },
    []
  );

  // Hydration & initial session + viewer profile restoration
  useEffect(() => {
    let isCancelled = false;

    async function initializeAuthAndData() {
      await Promise.resolve();
      if (isCancelled) return;

      const loadedProfile = loadViewerProfile();
      setViewerProfile(loadedProfile);
      setProfileHydrated(true);
      if (loadedProfile.onboardingCompleted && loadedProfile.name) {
        setSettings((prev) => ({
          ...prev,
          reviewerName: loadedProfile.name,
          reviewerRole: loadedProfile.role || prev.reviewerRole,
        }));
      }

      const reqGen = tenancyManager.currentGeneration;

      try {
        const { session: activeSession } = await restoreSession();

        if (activeSession && !isCancelled && tenancyManager.isCurrent(reqGen)) {
          // Retrieve membership under authenticated session & RLS
          const memberships = await fetchMemberships(activeSession.accessToken);
          if (isCancelled || !tenancyManager.isCurrent(reqGen)) return;
          setUserOrganisations(memberships);

          const savedOrg = localStorage.getItem(ORG_STORAGE_KEY) || null;
          const validSavedOrg =
            savedOrg && memberships.some((m) => m.organisation_id === savedOrg)
              ? savedOrg
              : null;
          const chosenOrg =
            validSavedOrg || (memberships.length > 0 ? memberships[0].organisation_id : null);

          if (chosenOrg) {
            const role = memberships.find((m) => m.organisation_id === chosenOrg)?.role || null;
            localStorage.setItem(ORG_STORAGE_KEY, chosenOrg);
            tenancyManager.updateState({
              organisationId: chosenOrg,
              userRole: role,
            });

            // Fetch primary brand for active organisation with generation protection
            const brandResult = await tenancyManager.resolveBrandForOrganisation({
              orgId: chosenOrg,
              fetchBrand: (targetOrg) => fetchPrimaryBrand(targetOrg, activeSession.accessToken),
            });

            // If stale, stop before fetching or applying reviews and activities
            if (!brandResult.success && brandResult.reason === "STALE") {
              return;
            }
            if (isCancelled || !tenancyManager.isCurrent(tenancyManager.currentGeneration, chosenOrg)) {
              return;
            }

            setSession(activeSession);
            setUser(activeSession.user);
            setUserOrganisations(memberships);
            updatePersistenceStatus(true, true);
            setAssets((prev) => prev.filter((a) => !a.isDemoFixture));

            // Fetch initial persisted data
            const dataGen = tenancyManager.currentGeneration;
            try {
              const supReviewRepo = new SupabaseReviewRepository();
              const supActivityRepo = new SupabaseActivityRepository();
              const [remoteReviews, remoteActivities] = await Promise.all([
                supReviewRepo.fetchReviews(chosenOrg),
                supActivityRepo.fetchActivities(chosenOrg, 100),
              ]);
              if (!isCancelled && tenancyManager.isCurrent(dataGen, chosenOrg)) {
                if (remoteReviews.length > 0) {
                  setReviews(remoteReviews);
                  setActiveReviewId(remoteReviews[0].id);
                }
                if (remoteActivities.length > 0) {
                  setActivities(remoteActivities);
                }
              }
            } catch {
              // Ignore initial fetch errors; user can reload
            }
          } else {
            // Authenticated user with no organisation membership
            if (!isCancelled && tenancyManager.isCurrent(reqGen)) {
              setSession(activeSession);
              setUser(activeSession.user);
              setUserOrganisations([]);
              tenancyManager.reset();
              updatePersistenceStatus(true, false);
            }
          }
        } else if (!isCancelled && tenancyManager.isCurrent(reqGen)) {
          // No session or unauthenticated
          setSession(null);
          setUser(null);
          setUserOrganisations([]);
          tenancyManager.reset();

          const demoPref = getDemoModePreference();
          const shouldEnterSharedDemo =
            demoPref === "shared" || (demoPref !== "local" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));

          if (shouldEnterSharedDemo) {
            updatePersistenceStatus(false, false, true);
            const demoGen = tenancyManager.currentGeneration;
            try {
              const demoRev = new DemoReviewRepository();
              const demoAct = new DemoActivityRepository();
              const [remoteReviews, remoteActivities] = await Promise.all([
                demoRev.fetchReviews(),
                demoAct.fetchActivities(),
              ]);
              if (!isCancelled && tenancyManager.isCurrent(demoGen)) {
                if (remoteReviews.length > 0) {
                  setReviews(remoteReviews);
                  setActiveReviewId(remoteReviews[0].id);
                }
                if (remoteActivities.length > 0) {
                  setActivities(remoteActivities);
                }
              }
            } catch {
              // Fallback to local storage if API route unavailable
            }
          } else {
            updatePersistenceStatus(false, false, false);
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved && !isCancelled && tenancyManager.isCurrent(reqGen)) {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed.reviews) && parsed.reviews.length > 0) {
                setReviews(parsed.reviews);
                setActiveReviewId(parsed.reviews[0].id);
              }
              if (Array.isArray(parsed.assets)) {
                const customAssets = (parsed.assets as BrandAsset[]).filter(
                  (a) => !a.isDemoFixture,
                );
                setAssets([...TERALUNE_CURATED_DEMO_ASSETS, ...customAssets]);
              }
              if (Array.isArray(parsed.activities)) setActivities(parsed.activities);
              if (parsed.settings) {
                setSettings((prev) => ({
                  ...DEFAULT_SETTINGS,
                  ...parsed.settings,
                  reviewerName: loadedProfile.onboardingCompleted
                    ? loadedProfile.name
                    : parsed.settings.reviewerName || prev.reviewerName,
                  reviewerRole: loadedProfile.onboardingCompleted
                    ? loadedProfile.role
                    : parsed.settings.reviewerRole || prev.reviewerRole,
                }));
              }
            }
          }
        }
      } catch {
        if (!isCancelled && tenancyManager.isCurrent(reqGen)) {
          updatePersistenceStatus(false, false);
        }
      } finally {
        if (!isCancelled) {
          setHydrated(true);
        }
      }
    }

    initializeAuthAndData();

    // Subscribe to auth state transitions
    const unsubscribe = onAuthStateChange((event, newSession) => {
      if (isCancelled) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setUser(null);
        setUserOrganisations([]);
        tenancyManager.reset();
        updatePersistenceStatus(false, false);
      } else if (newSession) {
        setSession(newSession);
        setUser(newSession.user);
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [fetchMemberships, fetchPrimaryBrand, tenancyManager, updatePersistenceStatus]);

  // Ensure authenticated users with an org enter workspace cleanly and trigger compulsory first-run tour
  const authFullName = user?.user_metadata?.full_name;
  const authRoleMeta = user?.user_metadata?.role;
  const authEmail = user?.email;
  const hasAuthenticatedOrg = Boolean(user && organisationId);
  const vpName = viewerProfile.name;
  const vpRole = viewerProfile.role;
  const vpAvatarId = viewerProfile.avatarId;
  const vpCustomAvatarDataUrl = viewerProfile.customAvatarDataUrl;
  const vpOnboardingCompleted = viewerProfile.onboardingCompleted;
  const vpGuidedTourCompleted = viewerProfile.guidedTourCompleted;
  const vpUpdatedAt = viewerProfile.updatedAt;
  useEffect(() => {
    if (!hydrated || !profileHydrated) return;

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;

      if (hasAuthenticatedOrg && !vpOnboardingCompleted) {
        const snapshotProfile: ViewerProfile = {
          name: vpName,
          role: vpRole,
          avatarId: vpAvatarId,
          customAvatarDataUrl: vpCustomAvatarDataUrl,
          onboardingCompleted: vpOnboardingCompleted,
          guidedTourCompleted: vpGuidedTourCompleted,
          updatedAt: vpUpdatedAt,
        };
        const resolvedActor = resolveActiveActorIdentity({
          viewerProfile: snapshotProfile,
          authUser: {
            email: authEmail,
            user_metadata: { full_name: authFullName, role: authRoleMeta },
          },
        });
        const next: ViewerProfile = {
          ...snapshotProfile,
          name: resolvedActor.name,
          role: resolvedActor.role,
          onboardingCompleted: true,
          guidedTourCompleted: vpGuidedTourCompleted,
          updatedAt: new Date().toISOString(),
        };
        saveViewerProfile(next);
        setViewerProfile(next);
        setSettings((prev) => ({
          ...prev,
          reviewerName: resolvedActor.name,
          reviewerRole: resolvedActor.role || prev.reviewerRole,
        }));
        return;
      }

      if (vpOnboardingCompleted && !vpGuidedTourCompleted) {
        setGuidedTourOpen(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    hydrated,
    profileHydrated,
    hasAuthenticatedOrg,
    authEmail,
    authFullName,
    authRoleMeta,
    vpName,
    vpRole,
    vpAvatarId,
    vpCustomAvatarDataUrl,
    vpOnboardingCompleted,
    vpGuidedTourCompleted,
    vpUpdatedAt,
  ]);

  // Sync to localStorage in DEMO_LOCAL or CONFIGURED_UNAUTHENTICATED modes
  useEffect(() => {
    if (!hydrated) return;
    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") return;

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ reviews, assets, activities, settings })
      );
    } catch {
      try {
        const compactReviews = reviews.map((rev) => ({
          ...rev,
          visualSummary: rev.visualSummary
            ? {
                ...rev.visualSummary,
                pages: rev.visualSummary.pages.map((p) => ({
                  ...p,
                  previewDataUrl: undefined,
                })),
              }
            : undefined,
        }));
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            reviews: compactReviews,
            assets,
            activities,
            settings,
          })
        );
      } catch {
        // Ignore quota issues in restricted browsers
      }
    }
  }, [reviews, assets, activities, settings, hydrated, persistenceMode]);

  // Load from Supabase when in AUTHENTICATED_SUPABASE or SHARED_DEMO mode
  const reloadFromPersistence = useCallback(async () => {
    if (persistenceMode !== "AUTHENTICATED_SUPABASE" && persistenceMode !== "SHARED_DEMO") return;
    startSync();
    const reqGen = tenancyManager.currentGeneration;
    let activeOrg: string | null = tenancyManager.organisationId || organisationId;
    try {
      if (persistenceMode === "SHARED_DEMO") {
        const [remoteReviews, remoteActivities] = await Promise.all([
          reviewRepo.fetchReviews(),
          activityRepo.fetchActivities(),
        ]);
        if (tenancyManager.isCurrent(reqGen)) {
          if (remoteReviews.length > 0) {
            setReviews(remoteReviews);
            if (!remoteReviews.some((r) => r.id === activeReviewId)) {
              setActiveReviewId(remoteReviews[0].id);
            }
          }
          if (remoteActivities.length > 0) {
            setActivities(remoteActivities);
          }
          notify("Workspace refreshed", "info");
        }
        return;
      }

      if (!activeOrg) {
        const memRes = await callPostgrest<{ organisation_id: string }[]>(
          "/rest/v1/organisation_members?select=organisation_id&limit=1"
        );
        if (!tenancyManager.isCurrent(reqGen)) {
          return;
        }
        if (memRes.data && memRes.data.length > 0) {
          activeOrg = memRes.data[0].organisation_id;
          setOrganisationId(activeOrg);
          localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
          tenancyManager.updateState({ organisationId: activeOrg });
        }
      }

      if (!activeOrg || !tenancyManager.isCurrent(reqGen, activeOrg)) {
        return;
      }

      const [remoteReviews, remoteActivities] = await Promise.all([
        reviewRepo.fetchReviews(activeOrg),
        activityRepo.fetchActivities(activeOrg, 100),
      ]);
      if (tenancyManager.isCurrent(reqGen, activeOrg)) {
        if (remoteReviews.length > 0) {
          setReviews(remoteReviews);
          if (!remoteReviews.some((r) => r.id === activeReviewId)) {
            setActiveReviewId(remoteReviews[0].id);
          }
        }
        if (remoteActivities.length > 0) {
          setActivities(remoteActivities);
        }
        notify("Workspace synced", "info");
      }
    } catch (err: unknown) {
      if (tenancyManager.isCurrent(reqGen, activeOrg)) {
        notify(err instanceof Error ? err.message : "Failed to refresh workspace", "error");
      }
    } finally {
      endSync();
    }
  }, [persistenceMode, organisationId, tenancyManager, reviewRepo, activityRepo, activeReviewId, notify, startSync, endSync]);

  // Auth Operations
  const signIn = useCallback(
    async (email: string, password: string) => {
      startSync();
      const reqGen = tenancyManager.currentGeneration;
      try {
        const res = await signInWithPassword({ email, password });
        if (!tenancyManager.isCurrent(reqGen)) {
          return {
            success: false,
            error: "Operation was superseded by a newer authentication or organisation change",
          };
        }
        if (res.error || !res.data) {
          notify(res.error?.message || "Invalid login credentials", "error");
          return { success: false, error: res.error?.message || "Invalid login credentials" };
        }

        const newSession = res.data.session;
        const memberships = await fetchMemberships(newSession.accessToken);
        if (!tenancyManager.isCurrent(reqGen)) {
          return {
            success: false,
            error: "Operation was superseded by a newer authentication or organisation change",
          };
        }

        if (memberships.length > 0) {
          const activeOrg = memberships[0].organisation_id;
          const activeRole = memberships[0].role;
          localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
          tenancyManager.updateState({
            organisationId: activeOrg,
            userRole: activeRole,
          });

          const brandResult = await tenancyManager.resolveBrandForOrganisation({
            orgId: activeOrg,
            fetchBrand: (targetOrg) => fetchPrimaryBrand(targetOrg, newSession.accessToken),
          });

          // If stale, stop that flow before fetching or applying reviews and activities
          if (!brandResult.success && brandResult.reason === "STALE") {
            return {
              success: false,
              error: "Operation was superseded by a newer authentication or organisation change",
            };
          }
          if (!tenancyManager.isCurrent(tenancyManager.currentGeneration, activeOrg)) {
            return {
              success: false,
              error: "Operation was superseded by a newer authentication or organisation change",
            };
          }

          setSession(newSession);
          setUser(newSession.user);
          setUserOrganisations(memberships);
          updatePersistenceStatus(true, true);

          const dataGen = tenancyManager.currentGeneration;
          try {
            const supReviewRepo = new SupabaseReviewRepository();
            const supActivityRepo = new SupabaseActivityRepository();
            const [remoteReviews, remoteActivities] = await Promise.all([
              supReviewRepo.fetchReviews(activeOrg),
              supActivityRepo.fetchActivities(activeOrg, 100),
            ]);
            if (tenancyManager.isCurrent(dataGen, activeOrg)) {
              if (remoteReviews.length > 0) {
                setReviews(remoteReviews);
                setActiveReviewId(remoteReviews[0].id);
              }
              if (remoteActivities.length > 0) {
                setActivities(remoteActivities);
              }
            }
          } catch {
            // Ignore fetch failure
          }
          if (tenancyManager.isCurrent(dataGen, activeOrg)) {
            notify(`Signed in as ${newSession.user.email} (${activeRole})`);
          }
        } else {
          setSession(newSession);
          setUser(newSession.user);
          setUserOrganisations([]);
          tenancyManager.reset();
          updatePersistenceStatus(true, false);
          notify(
            `Signed in as ${newSession.user.email}. Create an organisation to persist reviews.`,
            "info"
          );
        }
        return { success: true };
      } catch (err) {
        if (tenancyManager.isCurrent(reqGen)) {
          const msg = err instanceof Error ? err.message : "Sign in failed";
          notify(msg, "error");
          return { success: false, error: msg };
        }
        return {
          success: false,
          error: "Operation was superseded by a newer authentication or organisation change",
        };
      } finally {
        endSync();
      }
    },
    [fetchMemberships, fetchPrimaryBrand, tenancyManager, notify, updatePersistenceStatus, startSync, endSync]
  );

  const signUp = useCallback(
    async (email: string, password: string, metadata?: Record<string, unknown>) => {
      startSync();
      const reqGen = tenancyManager.currentGeneration;
      try {
        const res = await authSignUp({ email, password, metadata });
        if (!tenancyManager.isCurrent(reqGen)) {
          return {
            success: false,
            error: "Operation was superseded by a newer authentication or organisation change",
          };
        }
        if (res.error || !res.data) {
          notify(res.error?.message || "Sign up failed", "error");
          return { success: false, error: res.error?.message || "Sign up failed" };
        }

        if (res.data.session) {
          const newSession = res.data.session;
          const memberships = await fetchMemberships(newSession.accessToken);
          if (!tenancyManager.isCurrent(reqGen)) {
            return {
              success: false,
              error: "Operation was superseded by a newer authentication or organisation change",
            };
          }

          if (memberships.length > 0) {
            const activeOrg = memberships[0].organisation_id;
            const activeRole = memberships[0].role;
            localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
            tenancyManager.updateState({
              organisationId: activeOrg,
              userRole: activeRole,
            });

            const brandResult = await tenancyManager.resolveBrandForOrganisation({
              orgId: activeOrg,
              fetchBrand: (targetOrg) => fetchPrimaryBrand(targetOrg, newSession.accessToken),
            });

            // If stale, stop that flow before fetching or applying reviews and activities
            if (!brandResult.success && brandResult.reason === "STALE") {
              return {
                success: false,
                error: "Operation was superseded by a newer authentication or organisation change",
              };
            }
            if (!tenancyManager.isCurrent(tenancyManager.currentGeneration, activeOrg)) {
              return {
                success: false,
                error: "Operation was superseded by a newer authentication or organisation change",
              };
            }

            setSession(newSession);
            setUser(newSession.user);
            setUserOrganisations(memberships);
            updatePersistenceStatus(true, true);

            const dataGen = tenancyManager.currentGeneration;
            try {
              const supReviewRepo = new SupabaseReviewRepository();
              const supActivityRepo = new SupabaseActivityRepository();
              const [remoteReviews, remoteActivities] = await Promise.all([
                supReviewRepo.fetchReviews(activeOrg),
                supActivityRepo.fetchActivities(activeOrg, 100),
              ]);
              if (tenancyManager.isCurrent(dataGen, activeOrg)) {
                if (remoteReviews.length > 0) {
                  setReviews(remoteReviews);
                  setActiveReviewId(remoteReviews[0].id);
                }
                if (remoteActivities.length > 0) {
                  setActivities(remoteActivities);
                }
              }
            } catch {
              // Ignore fetch failure
            }

            if (tenancyManager.isCurrent(dataGen, activeOrg)) {
              notify(`Account created and signed in as ${res.data.user?.email}`);
            }
          } else {
            setSession(newSession);
            setUser(newSession.user);
            setUserOrganisations([]);
            tenancyManager.reset();
            updatePersistenceStatus(true, false);
            notify(`Account created and signed in as ${res.data.user?.email}`);
          }
        } else {
          if (tenancyManager.isCurrent(reqGen)) {
            notify("Account created. Please check your email to verify.", "info");
          }
        }
        return { success: true };
      } catch (err) {
        if (tenancyManager.isCurrent(reqGen)) {
          const msg = err instanceof Error ? err.message : "Sign up failed";
          notify(msg, "error");
          return { success: false, error: msg };
        }
        return {
          success: false,
          error: "Operation was superseded by a newer authentication or organisation change",
        };
      } finally {
        endSync();
      }
    },
    [fetchMemberships, fetchPrimaryBrand, tenancyManager, notify, updatePersistenceStatus, startSync, endSync]
  );

  const signOut = useCallback(async () => {
    startSync();
    try {
      await authSignOut();
      setUser(null);
      setSession(null);
      setUserOrganisations([]);
      tenancyManager.reset();
      updatePersistenceStatus(false, false);
      setAssets(TERALUNE_CURATED_DEMO_ASSETS);
      notify("Signed out", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Error during sign out", "error");
    } finally {
      endSync();
    }
  }, [tenancyManager, notify, updatePersistenceStatus, startSync, endSync]);

  const createOrganisation = useCallback(
    async (name: string) => {
      const cleanName = name.trim();
      if (cleanName.length < 2 || cleanName.length > 100) {
        notify("Organisation name must be between 2 and 100 characters", "error");
        return { success: false, error: "Organisation name must be between 2 and 100 characters" };
      }
      const token = session?.accessToken || getClientAuthToken();
      if (!token) {
        notify("Authentication required to create an organisation", "error");
        return { success: false, error: "Authentication required" };
      }

      startSync();
      try {
        const res = await callPostgrest<{
          organisation_id: string;
          brand_id: string;
          name: string;
          role: string;
        }>(
          "/rest/v1/rpc/create_organisation_and_owner",
          {
            method: "POST",
            body: { p_name: cleanName },
            authToken: token,
          }
        );

        if (res.error || !res.data) {
          const msg = res.error?.message || "Failed to create organisation";
          notify(msg, "error");
          return { success: false, error: msg };
        }

        const newOrgId = res.data.organisation_id;
        const newBrandId = res.data.brand_id;
        const newRole = res.data.role;

        if (!newOrgId || !newBrandId) {
          const msg =
            "Organisation creation returned an incomplete response (missing organisation_id or brand_id)";
          notify(msg, "error");
          return { success: false, error: msg };
        }

        tenancyManager.handleOrganisationCreated({
          organisationId: newOrgId,
          brandId: newBrandId,
          brandName: res.data.name,
          role: newRole,
        });

        setUserOrganisations((prev) => [
          ...prev,
          { organisation_id: newOrgId, role: newRole, name: res.data?.name },
        ]);
        updatePersistenceStatus(true, true);
        notify(`Created organisation "${res.data.name}" as ${newRole}`);
        return { success: true, orgId: newOrgId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create organisation";
        notify(msg, "error");
        return { success: false, error: msg };
      } finally {
        endSync();
      }
    },
    [session, tenancyManager, notify, updatePersistenceStatus, startSync, endSync]
  );

  const switchOrganisation = useCallback(
    async (orgId: string) => {
      const token = session?.accessToken || getClientAuthToken();
      const result = await tenancyManager.switchOrganisation({
        targetOrgId: orgId,
        userOrganisations,
        fetchBrand: (targetOrg) => fetchPrimaryBrand(targetOrg, token || undefined),
      });

      if (result.success) {
        updatePersistenceStatus(true, true);
        setTimeout(() => {
          reloadFromPersistence();
        }, 50);
      } else if (result.reason !== "STALE" && result.reason !== "NOT_A_MEMBER") {
        updatePersistenceStatus(true, true);
      }
    },
    [userOrganisations, session, tenancyManager, fetchPrimaryBrand, updatePersistenceStatus, reloadFromPersistence]
  );

  // Set Auth and Tenancy context
  const setAuthContext = useCallback(
    (token: string | null, orgId: string | null) => {
      setClientAuthToken(token);
      if (orgId) {
        localStorage.setItem(ORG_STORAGE_KEY, orgId);
        tenancyManager.updateState({ organisationId: orgId });
      } else {
        tenancyManager.reset();
      }
      setOrganisationId(orgId);
      updatePersistenceStatus(Boolean(token), Boolean(orgId));
    },
    [tenancyManager, updatePersistenceStatus]
  );

  const logActivity = (event: Omit<ActivityEvent, "id" | "timestamp">) => {
    const newEvent: ActivityEvent = {
      ...event,
      id: `act-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    };
    setActivities((prev) => [newEvent, ...prev]);
  };

  const recomputeScore = (findings: ReviewFinding[], baseScore: number): number => {
    if (findings.length === 0) return 100;
    const unresolvedPenalty = findings.reduce((sum, f) => {
      if (f.resolved) return sum;
      if (f.severity === "high") return sum + 12;
      if (f.severity === "medium") return sum + 6;
      return sum + 3;
    }, 0);
    return Math.max(40, Math.min(99, Math.max(baseScore, 98 - unresolvedPenalty)));
  };

  // 1. Submit Review (RPC 1)
  const addReview = async (review: ReviewSubmission, explicitBrandId?: string) => {
    const isSampleReview =
      review.brandId === TERALUNE_DEMO_BRAND_ID ||
      explicitBrandId === TERALUNE_DEMO_BRAND_ID;

    if (isSampleReview && persistenceMode === "AUTHENTICATED_SUPABASE") {
      setReviews((prev) => [review, ...prev]);
      setActiveReviewId(review.id);
      logActivity({
        reviewId: review.id,
        actor: review.submittedBy,
        action: "evaluated sample content against Teralune v1.0 guidelines:",
        target: review.title,
        type: "submitted",
      });
      notify(`"${review.title}" ready in Review Studio`);
      return;
    }

    const { organisationId: targetOrgId, brandId: targetBrandId } =
      tenancyManager.validateReviewSubmissionTenancy({
        persistenceMode,
        explicitBrandId,
      });

    const prevReviews = reviews;
    const prevActivities = activities;

    // Optimistic local state update
    setReviews((prev) => [review, ...prev]);
    setActiveReviewId(review.id);
    logActivity({
      reviewId: review.id,
      actor: review.submittedBy,
      action: "submitted content for governance review:",
      target: review.title,
      type: "submitted",
    });

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
      try {
        await reviewRepo.submitReview({
          review,
          organisationId: targetOrgId,
          brandId: targetBrandId,
        });
        notify(`"${review.title}" submitted for review`);
      } catch (err: unknown) {
        // Rollback optimistic state
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save review submission", "error");
        throw err;
      }
    } else {
      notify("Review added to workspace");
    }
  };

  // 2. Update Review Status (RPC 2)
  const updateReviewStatus = async (
    reviewId: string,
    status: ReviewStatus,
    reviewerNotes?: string
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    if (!targetReview || targetReview.status === status) return;

    const allowedTransitions: Record<ReviewStatus, ReviewStatus[]> = {
      "Pending Approval": ["In Review", "Changes Requested", "Approved"],
      "In Review": ["Changes Requested", "Approved"],
      "Changes Requested": ["In Review", "Approved"],
      Approved: ["In Review"],
    };

    if (!allowedTransitions[targetReview.status].includes(status)) {
      notify(`Cannot move a ${targetReview.status} review to ${status}`, "info");
      return;
    }

    const prevReviews = reviews;
    const prevActivities = activities;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? {
              ...r,
              status,
              reviewerNotes: reviewerNotes !== undefined ? reviewerNotes : r.reviewerNotes,
            }
          : r
      )
    );

    logActivity({
      reviewId,
      actor: settings.reviewerName,
      action:
        status === "Approved"
          ? "approved submission:"
          : status === "Changes Requested"
          ? "requested changes on"
          : `moved review status to ${status} for`,
      target: targetReview.title,
      type:
        status === "Approved"
          ? "approved"
          : status === "Changes Requested"
          ? "changes_requested"
          : "resolved",
    });

    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      targetReview.brandId === TERALUNE_DEMO_BRAND_ID;

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        await reviewRepo.updateReviewStatus({
          reviewId,
          status,
          reviewerNotes,
          actorName: settings.reviewerName,
        });
        notify(`Status updated to ${status}`);
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to update review status", "error");
      }
    } else {
      notify(`Status updated to ${status}`);
    }
  };

  // 3. Toggle Finding Resolved (RPC 3)
  const toggleFindingResolved = async (reviewId: string, findingId: string) => {
    const existingReview = reviews.find((r) => r.id === reviewId);
    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      existingReview?.brandId === TERALUNE_DEMO_BRAND_ID;

    let resolvedNow = false;
    let targetTitle = "";
    const prevReviews = reviews;
    const prevActivities = activities;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        targetTitle = r.title;
        const nextFindings = r.findings.map((f) => {
          if (f.id !== findingId) return f;
          resolvedNow = !f.resolved;
          return {
            ...f,
            resolved: resolvedNow,
            resolvedAt: resolvedNow ? new Date().toISOString() : undefined,
            resolvedBy: resolvedNow ? settings.reviewerName : undefined,
          };
        });
        return {
          ...r,
          findings: nextFindings,
          complianceScore: recomputeScore(nextFindings, r.complianceScore),
        };
      })
    );

    if (targetTitle) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: resolvedNow ? "marked finding resolved in" : "reopened finding in",
        target: targetTitle,
        type: "resolved",
      });
    }

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        const res = await reviewRepo.toggleFindingResolved({
          reviewId,
          findingId,
          actorName: settings.reviewerName,
        });
        // Sync recomputed score
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, complianceScore: res.complianceScore } : r
          )
        );
        notify(res.resolved ? "Finding marked as resolved" : "Finding reopened");
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to update finding status", "error");
      }
    } else {
      notify(resolvedNow ? "Finding marked as resolved" : "Finding reopened");
    }
  };

  // 4. Apply Finding Correction (RPC 4)
  const updateFindingCorrection = async (
    reviewId: string,
    findingId: string,
    editedText: string,
    applyToCopy = false
  ) => {
 const targetReview = reviews.find((r) => r.id === reviewId);
const targetFinding = targetReview?.findings.find(
  (f) => f.id === findingId
);

if (!targetReview || !targetFinding) {
  notify("Review or finding not found. Refresh and try again.", "error");
  return;
}

if (applyToCopy) {
  const replacement = editedText.trim();
  const affectedText = targetFinding.affectedContent;

  if (!replacement) {
    notify(
      "Enter replacement text before applying a correction.",
      "error"
    );
    return;
  }

  if (!affectedText || !affectedText.trim()) {
    notify(
      "This finding has no text target. Revise the content or creative and recheck it.",
      "error"
    );
    return;
  }

  const firstMatch = targetReview.textContent.indexOf(affectedText);

  if (firstMatch === -1) {
    notify(
      "The original text is no longer present. Recheck the latest content before applying this correction.",
      "error"
    );
    return;
  }

  const secondMatch = targetReview.textContent.indexOf(
    affectedText,
    firstMatch + 1
  );

  if (secondMatch !== -1) {
    notify(
      "This text appears more than once. Automatic replacement is paused until the intended occurrence can be selected.",
      "error"
    );
    return;
  }

  if (replacement === affectedText) {
    notify(
      "The replacement is identical to the original text. No correction was applied.",
      "info"
    );
    return;
  }
}

const prevReviews = reviews;
const prevActivities = activities;
    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        const finding = r.findings.find((f) => f.id === findingId);
        let updatedTextContent = r.textContent;
        if (applyToCopy && finding?.affectedContent && editedText.trim()) {
          if (updatedTextContent.includes(finding.affectedContent)) {
            updatedTextContent = updatedTextContent.replace(
              finding.affectedContent,
              editedText.trim()
            );
          }
        }
        const nextFindings = r.findings.map((f) =>
          f.id === findingId
            ? {
                ...f,
                editedCorrection: editedText,
                resolved: applyToCopy ? true : f.resolved,
                resolvedAt: applyToCopy
                  ? new Date().toISOString()
                  : f.resolved
                  ? f.resolvedAt
                  : undefined,
                resolvedBy: applyToCopy
                  ? settings.reviewerName
                  : f.resolved
                  ? f.resolvedBy
                  : undefined,
              }
            : f
        );
        return {
          ...r,
          textContent: updatedTextContent,
          findings: nextFindings,
          complianceScore: applyToCopy
            ? recomputeScore(nextFindings, r.complianceScore)
            : r.complianceScore,
        };
      })
    );

    if (applyToCopy && targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `applied correction for "${targetFinding?.title || "finding"}" in`,
        target: targetReview.title,
        type: "correction_applied",
      });
    }

    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      targetReview.brandId === TERALUNE_DEMO_BRAND_ID;

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        const res = await reviewRepo.applyFindingCorrection({
          reviewId,
          findingId,
          editedText,
          applyToCopy,
          actorName: settings.reviewerName,
        });
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, complianceScore: res.complianceScore } : r
          )
        );
        notify(
          applyToCopy
            ? "Correction applied to copy & resolved"
            : "Correction draft saved"
        );
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save correction", "error");
      }
    } else {
      notify(applyToCopy ? "Correction applied to copy & resolved" : "Correction draft saved");
    }
  };

  // 5. Update Finding Decision (RPC 5)
  const updateFindingDecision = async (
    reviewId: string,
    findingId: string,
    decision: ReviewDecision,
    reason?: string
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    const targetFinding = targetReview?.findings.find((f) => f.id === findingId);
    if (!targetReview || !targetFinding) return;

    const decisionError = getFindingDecisionValidationError(decision, reason);
    if (decisionError) {
      notify(decisionError, "info");
      return;
    }

    if (
      targetFinding.reviewDecision === decision &&
      (!reason?.trim() || targetFinding.reviewDecisionReason === reason.trim())
    ) {
      return;
    }

    const prevReviews = reviews;
    const prevActivities = activities;
    const timestamp = new Date().toISOString();
    const nextDecision = buildFindingDecisionPatch(
      decision,
      reason,
      settings.reviewerName,
      timestamp
    );

    // Optimistic update
    setReviews((prev) =>
      prev.map((review) =>
        review.id !== reviewId
          ? review
          : {
              ...review,
              findings: review.findings.map((finding) =>
                finding.id === findingId ? { ...finding, ...nextDecision } : finding
              ),
            }
      )
    );

    logActivity({
      reviewId,
      actor: settings.reviewerName,
      action: `${decision.toLowerCase()} finding "${targetFinding.title}"${
        reason?.trim() ? `: ${reason.trim()}` : ""
      } in`,
      target: targetReview.title,
      type: "finding_decision",
    });

    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      targetReview.brandId === TERALUNE_DEMO_BRAND_ID;

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        await reviewRepo.updateFindingDecision({
          reviewId,
          findingId,
          decision,
          reason,
          actorName: settings.reviewerName,
        });
        notify(
          decision === "APPROVE"
            ? "Finding accepted"
            : decision === "REJECT"
            ? "Finding rejected"
            : "Finding marked for human review"
        );
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save decision", "error");
      }
    } else {
      notify(
        decision === "APPROVE"
          ? "Finding accepted"
          : decision === "REJECT"
          ? "Finding rejected"
          : "Finding marked for human review"
      );
    }
  };

  // 6. Add Finding Comment (RPC 6)
  const addFindingComment = async (reviewId: string, findingId: string, text: string) => {
    if (!text.trim()) return;
    const targetReview = reviews.find((r) => r.id === reviewId);
    const targetFinding = targetReview?.findings.find((f) => f.id === findingId);
    const prevReviews = reviews;
    const prevActivities = activities;
    const commentId = `cmt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        return {
          ...r,
          findings: r.findings.map((f) =>
            f.id === findingId
              ? {
                  ...f,
                  comments: [
                    ...f.comments,
                    {
                      id: commentId,
                      author: settings.reviewerName,
                      role: settings.reviewerRole,
                      text: text.trim(),
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : f
          ),
        };
      })
    );

    if (targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `commented on finding "${targetFinding?.title || "issue"}" in`,
        target: targetReview.title,
        type: "comment_added",
      });
    }

    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      targetReview?.brandId === TERALUNE_DEMO_BRAND_ID;

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        await reviewRepo.addFindingComment({
          reviewId,
          findingId,
          commentId,
          text: text.trim(),
          authorName: settings.reviewerName,
          authorRole: settings.reviewerRole,
        });
        notify("Reviewer comment added");
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save comment", "error");
      }
    } else {
      notify("Reviewer comment added");
    }
  };

  // 7. Add Manual Finding (RPC 7)
  const addManualFinding = async (
    reviewId: string,
    finding: ReviewFinding,
    brandRuleId?: string
  ) => {
    const targetReview = reviews.find((r) => r.id === reviewId);
    const prevReviews = reviews;
    const prevActivities = activities;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;
        const nextFindings = [finding, ...r.findings];
        return {
          ...r,
          findings: nextFindings,
          complianceScore: recomputeScore(nextFindings, r.complianceScore),
        };
      })
    );

    if (targetReview) {
      logActivity({
        reviewId,
        actor: settings.reviewerName,
        action: `added manual finding "${finding.title}" to`,
        target: targetReview.title,
        type: "manual_finding_added",
      });
    }

    const isSampleLocalReview =
      persistenceMode === "AUTHENTICATED_SUPABASE" &&
      targetReview?.brandId === TERALUNE_DEMO_BRAND_ID;

    if (
      (persistenceMode === "AUTHENTICATED_SUPABASE" && !isSampleLocalReview) ||
      persistenceMode === "SHARED_DEMO"
    ) {
      try {
        const res = await reviewRepo.addManualFinding({
          reviewId,
          finding,
          brandRuleId,
          actorName: settings.reviewerName,
        });
        setReviews((prev) =>
          prev.map((r) =>
            r.id === reviewId ? { ...r, complianceScore: res.complianceScore } : r
          )
        );
        notify("Manual governance finding added");
      } catch (err: unknown) {
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save manual finding", "error");
      }
    } else {
      notify("Manual governance finding added");
    }
  };

  const getEffectiveOrgId = useCallback(
    (overrideOrgId?: string) => {
      if (overrideOrgId) return overrideOrgId;
      if (persistenceMode === "AUTHENTICATED_SUPABASE" && organisationId) {
        return organisationId;
      }
      if (persistenceMode === "SHARED_DEMO") {
        return DEMO_CONFIG.ORGANISATION_ID;
      }
      return "local-org";
    },
    [persistenceMode, organisationId]
  );

  const buildKnowledgeAuthHeaders = useCallback((): Record<string, string> => {
    const token = session?.accessToken || getClientAuthToken();
    if (token && persistenceMode === "AUTHENTICATED_SUPABASE") {
      return { Authorization: `Bearer ${token}` };
    }
    return {};
  }, [session?.accessToken, persistenceMode]);

  const loadKnowledgeForBrand = useCallback(
    async (targetBrandId: string, overrideOrgId?: string) => {
      if (!targetBrandId) return;
      const reqGen = ++knowledgeReqGenRef.current;
      knowledgeAbortRef.current?.abort();
      const controller = new AbortController();
      knowledgeAbortRef.current = controller;

      const orgParam = getEffectiveOrgId(overrideOrgId);
      setKnowledgeLoading(true);
      setKnowledgeError(null);
      try {
        const params = new URLSearchParams({
          brandId: targetBrandId,
          status: "all",
          organisationId: orgParam,
        });
        const res = await fetch(`/api/knowledge?${params.toString()}`, {
          headers: buildKnowledgeAuthHeaders(),
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          brand?: WorkspaceBrandRecord;
          entries?: ManagedKnowledgeEntry[];
          snapshots?: ContextBrandVersionSnapshot[];
        };
        if (knowledgeReqGenRef.current !== reqGen) return;
        if (!res.ok) {
          throw new Error(body.error || "Failed to load brand knowledge.");
        }
        const entries = Array.isArray(body.entries)
          ? body.entries.map(mapManagedEntryToUiEntry)
          : [];
        const snapshots = Array.isArray(body.snapshots)
          ? body.snapshots.map(mapSnapshotToUiSnapshot)
          : [];
        setKnowledge(entries);
        setVersionSnapshots(snapshots);
        setSelectedBrandVersionId((currentVer) =>
          currentVer === LATEST_KNOWLEDGE_VERSION_ID ||
          snapshots.some((s) => s.versionId === currentVer)
            ? currentVer
            : LATEST_KNOWLEDGE_VERSION_ID
        );
        if (body.brand) {
          const mappedBrand = mapBrandRecordToWorkspaceBrand(body.brand);
          setWorkspaceBrands((prev) => {
            const exists = prev.some((b) => b.brandId === mappedBrand.brandId);
            return exists
              ? prev.map((b) =>
                  b.brandId === mappedBrand.brandId ? mappedBrand : b
                )
              : [mappedBrand, ...prev];
          });
        }
      } catch (err) {
        if (
          (err instanceof DOMException && err.name === "AbortError") ||
          knowledgeReqGenRef.current !== reqGen
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load brand knowledge.";
        setKnowledgeError(message);
      } finally {
        if (knowledgeReqGenRef.current === reqGen) {
          setKnowledgeLoading(false);
        }
      }
    },
    [buildKnowledgeAuthHeaders, getEffectiveOrgId]
  );

  const refreshBrands = useCallback(
    async (overrideOrgId?: string) => {
      const refreshGen = ++brandsReqGenRef.current;
      brandsAbortRef.current?.abort();
      const controller = new AbortController();
      brandsAbortRef.current = controller;

      if (
        persistenceMode === "CONFIGURED_UNAUTHENTICATED" ||
        persistenceMode === "AUTHENTICATED_NO_ORGANISATION"
      ) {
        knowledgeReqGenRef.current += 1;
        knowledgeAbortRef.current?.abort();
        setWorkspaceBrands([]);
        setSelectedBrandId(null);
        setSelectedBrandVersionId(LATEST_KNOWLEDGE_VERSION_ID);
        setKnowledge([]);
        setVersionSnapshots([]);
        setKnowledgeError(null);
        setKnowledgeLoading(false);
        return;
      }

      const orgParam = getEffectiveOrgId(overrideOrgId);
      setKnowledgeLoading(true);
      setKnowledgeError(null);
      try {
        const params = new URLSearchParams({ organisationId: orgParam });
        const res = await fetch(`/api/brands?${params.toString()}`, {
          headers: buildKnowledgeAuthHeaders(),
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          brands?: WorkspaceBrandRecord[];
        };
        if (brandsReqGenRef.current !== refreshGen) return;
        if (!res.ok) {
          throw new Error(body.error || "Failed to load brands.");
        }
        const brands = Array.isArray(body.brands)
          ? body.brands.map(mapBrandRecordToWorkspaceBrand)
          : [];
        setWorkspaceBrands(brands);

        const storedBrandId =
          typeof window !== "undefined"
            ? localStorage.getItem(BRAND_STORAGE_KEY)
            : null;
        if (
          persistenceMode === "AUTHENTICATED_SUPABASE" &&
          storedBrandId === TERALUNE_DEMO_BRAND_ID &&
          typeof window !== "undefined"
        ) {
          localStorage.removeItem(BRAND_STORAGE_KEY);
        }
        const safeStoredBrandId =
          persistenceMode === "AUTHENTICATED_SUPABASE" &&
          storedBrandId === TERALUNE_DEMO_BRAND_ID
            ? null
            : storedBrandId;
        const currentSelected = selectedBrandIdRef.current;
        const preferred =
          persistenceMode === "AUTHENTICATED_SUPABASE"
            ? brands.find((b) => b.brandId === currentSelected) ||
              brands.find((b) => b.brandId === safeStoredBrandId) ||
              brands.find((b) => !b.isSample) ||
              brands[0] ||
              null
            : brands.find((b) => b.brandId === currentSelected) ||
              brands.find((b) => b.brandId === safeStoredBrandId) ||
              brands.find((b) => b.brandId === TERALUNE_DEMO_BRAND_ID) ||
              brands[0] ||
              null;

        if (preferred) {
          if (preferred.brandId !== currentSelected) {
            setSelectedBrandVersionId(LATEST_KNOWLEDGE_VERSION_ID);
            setKnowledge([]);
            setVersionSnapshots([]);
          }
          setSelectedBrandId(preferred.brandId);
          if (typeof window !== "undefined") {
            localStorage.setItem(BRAND_STORAGE_KEY, preferred.brandId);
          }
          if (
            persistenceMode === "AUTHENTICATED_SUPABASE" &&
            !preferred.isSample &&
            preferred.organisationId === organisationId
          ) {
            tenancyManager.updateState({
              brandId: preferred.brandId,
              brandName: preferred.brandName,
            });
          }
          await loadKnowledgeForBrand(preferred.brandId, orgParam);
        } else {
          if (persistenceMode === "AUTHENTICATED_SUPABASE" && typeof window !== "undefined") {
            localStorage.removeItem(BRAND_STORAGE_KEY);
          }
          setSelectedBrandId(null);
          setSelectedBrandVersionId(LATEST_KNOWLEDGE_VERSION_ID);
          setKnowledge([]);
          setVersionSnapshots([]);
          setKnowledgeLoading(false);
        }
      } catch (err) {
        if (
          (err instanceof DOMException && err.name === "AbortError") ||
          brandsReqGenRef.current !== refreshGen
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load brands.";
        setKnowledgeError(message);
        setKnowledgeLoading(false);
      }
    },
    [
      persistenceMode,
      organisationId,
      getEffectiveOrgId,
      buildKnowledgeAuthHeaders,
      tenancyManager,
      loadKnowledgeForBrand,
    ]
  );

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void refreshBrands();
      }
    });
    return () => {
      cancelled = true;
    };
    // Refresh brand registry when hydration completes or tenancy mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, persistenceMode, organisationId]);

  const selectBrand = useCallback(
    async (targetBrandId: string) => {
      if (!targetBrandId) return;
      const isChangingBrand = targetBrandId !== selectedBrandIdRef.current;
      selectedBrandIdRef.current = targetBrandId;
      const target = workspaceBrands.find((b) => b.brandId === targetBrandId);
      setSelectedBrandId(targetBrandId);
      setSelectedBrandVersionId(LATEST_KNOWLEDGE_VERSION_ID);
      if (isChangingBrand) {
        setKnowledge([]);
        setVersionSnapshots([]);
      }
      setKnowledgeError(null);
      if (typeof window !== "undefined") {
        localStorage.setItem(BRAND_STORAGE_KEY, targetBrandId);
      }
      if (
        target &&
        persistenceMode === "AUTHENTICATED_SUPABASE" &&
        !target.isSample &&
        target.organisationId === organisationId
      ) {
        tenancyManager.updateState({
          brandId: target.brandId,
          brandName: target.brandName,
        });
      }
      await loadKnowledgeForBrand(targetBrandId);
    },
    [
      workspaceBrands,
      persistenceMode,
      organisationId,
      tenancyManager,
      loadKnowledgeForBrand,
    ]
  );

  const selectBrandVersion = useCallback((versionId: string) => {
    setSelectedBrandVersionId(versionId.trim() || LATEST_KNOWLEDGE_VERSION_ID);
  }, []);

  const createWorkspaceBrand = useCallback(
    async (input: {
      brandName: string;
      description?: string;
      website?: string;
      profileSummary?: string;
      voiceAndToneSummary?: string;
    }): Promise<WorkspaceBrand> => {
      const orgParam = getEffectiveOrgId();
      setKnowledgeMutating(true);
      setKnowledgeError(null);
      try {
        const res = await fetch("/api/brands", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildKnowledgeAuthHeaders(),
          },
          body: JSON.stringify({
            ...input,
            organisationId: orgParam,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          brand?: WorkspaceBrandRecord;
        };
        if (!res.ok || !body.brand) {
          throw new Error(body.error || "Failed to create brand.");
        }
        const created = mapBrandRecordToWorkspaceBrand(body.brand);
        setWorkspaceBrands((prev) => [created, ...prev]);
        setSelectedBrandId(created.brandId);
        if (typeof window !== "undefined") {
          localStorage.setItem(BRAND_STORAGE_KEY, created.brandId);
        }
        if (
          persistenceMode === "AUTHENTICATED_SUPABASE" &&
          created.organisationId === organisationId
        ) {
          tenancyManager.updateState({
            brandId: created.brandId,
            brandName: created.brandName,
          });
        }
        setKnowledge([]);
        setVersionSnapshots([]);
        logActivity({
          actor: settings.reviewerName,
          action: "created brand profile:",
          target: created.brandName,
          type: "knowledge_updated",
        });
        notify(`Created brand "${created.brandName}"`);
        return created;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create brand.";
        setKnowledgeError(msg);
        notify(msg, "error");
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setKnowledgeMutating(false);
      }
    },
    [
      getEffectiveOrgId,
      buildKnowledgeAuthHeaders,
      persistenceMode,
      organisationId,
      tenancyManager,
      settings.reviewerName,
      notify,
    ]
  );

  const getKnowledgeRequestContext = useCallback(() => {
    return {
      organisationId: getEffectiveOrgId(),
      headers: buildKnowledgeAuthHeaders(),
    };
  }, [getEffectiveOrgId, buildKnowledgeAuthHeaders]);

  const reloadSelectedBrandKnowledge = useCallback(async () => {
    if (!selectedBrandId) return;
    await loadKnowledgeForBrand(selectedBrandId);
  }, [selectedBrandId, loadKnowledgeForBrand]);

  const saveKnowledgeEntry = useCallback(
    async (input: {
      id?: string;
      brandId?: string;
      section: KnowledgeSection;
      title: string;
      content: string;
      preferredTerm?: string;
      avoidTerm?: string;
      hexCodes?: string[];
      fontFamily?: string;
      supportingEvidence?: string;
      restrictions?: string[];
      severity?: "high" | "medium" | "low";
      sourceDocumentId?: string;
      sourceTitle?: string;
      sourceDocumentVersion?: string;
      sectionRef?: string;
      pageNumber?: number;
      versionId?: string;
      publishImmediately?: boolean;
    }): Promise<KnowledgeEntry> => {
      const targetBrandId = input.brandId || selectedBrandId;
      if (!targetBrandId) {
        throw new Error("Please select or create a brand before saving rules.");
      }
      const orgParam = getEffectiveOrgId();
      const existingEntry = input.id
        ? knowledge.find((k) => k.id === input.id)
        : undefined;
      setKnowledgeMutating(true);
      setKnowledgeError(null);
      try {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildKnowledgeAuthHeaders(),
          },
          body: JSON.stringify({
            action: input.publishImmediately ? "save_and_publish" : "save_draft",
            ...(input.id ? { id: input.id } : {}),
            brandId: targetBrandId,
            organisationId: orgParam,
            section: input.section,
            title: input.title,
            content: input.content,
            ...(existingEntry?.entryOrigin
              ? { entryOrigin: existingEntry.entryOrigin }
              : {}),
            ...(input.preferredTerm ? { preferredTerm: input.preferredTerm } : {}),
            ...(input.avoidTerm ? { avoidTerm: input.avoidTerm } : {}),
            ...(input.hexCodes && input.hexCodes.length > 0
              ? { hexCodes: input.hexCodes }
              : {}),
            ...(input.fontFamily ? { fontFamily: input.fontFamily } : {}),
            ...(input.supportingEvidence
              ? { supportingEvidence: input.supportingEvidence }
              : {}),
            ...(input.restrictions && input.restrictions.length > 0
              ? { restrictions: input.restrictions }
              : {}),
            ...(input.severity ? { severity: input.severity } : {}),
            ...(input.sourceDocumentId
              ? { sourceDocumentId: input.sourceDocumentId }
              : {}),
            ...(input.sourceTitle ? { sourceTitle: input.sourceTitle } : {}),
            ...(input.sourceDocumentVersion || existingEntry?.sourceDocumentVersion
              ? {
                  sourceDocumentVersion:
                    input.sourceDocumentVersion ||
                    existingEntry?.sourceDocumentVersion,
                }
              : {}),
            ...(input.sectionRef ? { sectionRef: input.sectionRef } : {}),
            ...(input.pageNumber ? { pageNumber: input.pageNumber } : {}),
            ...(input.versionId ? { versionId: input.versionId } : {}),
            owner: settings.reviewerName,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          entry?: ManagedKnowledgeEntry;
          brand?: WorkspaceBrandRecord;
          snapshots?: ContextBrandVersionSnapshot[];
        };
        if (!res.ok || !body.entry) {
          throw new Error(body.error || "Failed to save knowledge entry.");
        }

        const saved = mapManagedEntryToUiEntry(body.entry);
        setKnowledge((prev) => {
          const exists = prev.some((k) => k.id === saved.id);
          return exists
            ? prev.map((k) => (k.id === saved.id ? saved : k))
            : [saved, ...prev];
        });
        if (body.brand) {
          const mappedBrand = mapBrandRecordToWorkspaceBrand(body.brand);
          setWorkspaceBrands((prev) =>
            prev.map((b) =>
              b.brandId === mappedBrand.brandId ? mappedBrand : b
            )
          );
        }
        if (Array.isArray(body.snapshots)) {
          setVersionSnapshots(body.snapshots.map(mapSnapshotToUiSnapshot));
        }

        logActivity({
          actor: settings.reviewerName,
          action: input.publishImmediately
            ? "published knowledge entry:"
            : input.id
            ? "updated draft knowledge entry:"
            : "saved draft knowledge entry:",
          target: saved.title,
          type: "knowledge_updated",
        });
        notify(
          input.publishImmediately
            ? `Published "${saved.title}" (${saved.versionId})`
            : `Saved draft "${saved.title}"`
        );
        return saved;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to save knowledge entry.";
        setKnowledgeError(msg);
        notify(msg, "error");
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setKnowledgeMutating(false);
      }
    },
    [
      selectedBrandId,
      knowledge,
      getEffectiveOrgId,
      buildKnowledgeAuthHeaders,
      settings.reviewerName,
      notify,
    ]
  );

  const publishKnowledgeEntry = useCallback(
    async (entryId: string, note?: string): Promise<KnowledgeEntry> => {
      const target = knowledge.find((k) => k.id === entryId);
      const targetBrandId = target?.brandId || selectedBrandId;
      if (!targetBrandId) {
        throw new Error("No active brand selected for publishing.");
      }
      const orgParam = getEffectiveOrgId();
      setKnowledgeMutating(true);
      setKnowledgeError(null);
      try {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildKnowledgeAuthHeaders(),
          },
          body: JSON.stringify({
            action: "publish",
            entryId,
            brandId: targetBrandId,
            organisationId: orgParam,
            actor: settings.reviewerName,
            ...(note?.trim() ? { note: note.trim() } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          entry?: ManagedKnowledgeEntry;
          snapshot?: ContextBrandVersionSnapshot;
          brand?: WorkspaceBrandRecord;
          snapshots?: ContextBrandVersionSnapshot[];
        };
        if (!res.ok || !body.entry) {
          throw new Error(body.error || "Failed to publish knowledge entry.");
        }
        const published = mapManagedEntryToUiEntry(body.entry);
        setKnowledge((prev) =>
          prev.map((k) => (k.id === published.id ? published : k))
        );
        if (body.brand) {
          const mappedBrand = mapBrandRecordToWorkspaceBrand(body.brand);
          setWorkspaceBrands((prev) =>
            prev.map((b) =>
              b.brandId === mappedBrand.brandId ? mappedBrand : b
            )
          );
        }
        if (Array.isArray(body.snapshots)) {
          setVersionSnapshots(body.snapshots.map(mapSnapshotToUiSnapshot));
        }
        logActivity({
          actor: settings.reviewerName,
          action: "published knowledge entry:",
          target: published.title,
          type: "knowledge_updated",
        });
        notify(
          `Published "${published.title}" (${
            body.snapshot?.versionId || published.versionId || "latest"
          })`
        );
        return published;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to publish knowledge entry.";
        setKnowledgeError(msg);
        notify(msg, "error");
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setKnowledgeMutating(false);
      }
    },
    [
      knowledge,
      selectedBrandId,
      getEffectiveOrgId,
      buildKnowledgeAuthHeaders,
      settings.reviewerName,
      notify,
    ]
  );

  const archiveKnowledgeEntry = useCallback(
    async (entryId: string): Promise<KnowledgeEntry> => {
      const target = knowledge.find((k) => k.id === entryId);
      const targetBrandId = target?.brandId || selectedBrandId;
      if (!targetBrandId) {
        throw new Error("No active brand selected for archiving.");
      }
      const orgParam = getEffectiveOrgId();
      setKnowledgeMutating(true);
      setKnowledgeError(null);
      try {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildKnowledgeAuthHeaders(),
          },
          body: JSON.stringify({
            action: "archive",
            entryId,
            brandId: targetBrandId,
            organisationId: orgParam,
            actor: settings.reviewerName,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          entry?: ManagedKnowledgeEntry;
          brand?: WorkspaceBrandRecord;
        };
        if (!res.ok || !body.entry) {
          throw new Error(body.error || "Failed to archive knowledge entry.");
        }
        const archived = mapManagedEntryToUiEntry(body.entry);
        setKnowledge((prev) =>
          prev.map((k) => (k.id === archived.id ? archived : k))
        );
        if (body.brand) {
          const mappedBrand = mapBrandRecordToWorkspaceBrand(body.brand);
          setWorkspaceBrands((prev) =>
            prev.map((b) =>
              b.brandId === mappedBrand.brandId ? mappedBrand : b
            )
          );
        }
        logActivity({
          actor: settings.reviewerName,
          action: "archived knowledge entry:",
          target: archived.title,
          type: "knowledge_updated",
        });
        notify(`Archived "${archived.title}"`, "info");
        return archived;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to archive knowledge entry.";
        setKnowledgeError(msg);
        notify(msg, "error");
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setKnowledgeMutating(false);
      }
    },
    [
      knowledge,
      selectedBrandId,
      getEffectiveOrgId,
      buildKnowledgeAuthHeaders,
      settings.reviewerName,
      notify,
    ]
  );

  // Backwards-compatible wrappers delegating to async persistence
  const upsertKnowledgeEntry = (entry: KnowledgeEntry) => {
    void saveKnowledgeEntry({
      id: entry.id.startsWith("kb-") && !knowledge.some((k) => k.id === entry.id)
        ? undefined
        : entry.id,
      brandId: entry.brandId || selectedBrandId || undefined,
      section: entry.section,
      title: entry.title,
      content: entry.content,
      preferredTerm: entry.preferredTerm,
      avoidTerm: entry.avoidTerm,
      hexCodes: entry.hexCodes,
      fontFamily: entry.fontFamily,
      sourceDocumentId: entry.sourceDocumentId,
      sourceTitle: entry.sourceTitle,
      sectionRef: entry.sectionRef,
      pageNumber: entry.pageNumber,
      versionId: entry.versionId,
      publishImmediately: entry.status === "Approved",
    }).catch(() => {});
  };

  const deleteKnowledgeEntry = (id: string) => {
    void archiveKnowledgeEntry(id).catch(() => {});
  };

  const toggleKnowledgeStatus = (id: string) => {
    const target = knowledge.find((k) => k.id === id);
    if (!target) return;
    if (target.status === "Approved") {
      void saveKnowledgeEntry({
        id: target.id,
        brandId: target.brandId,
        section: target.section,
        title: target.title,
        content: target.content,
        preferredTerm: target.preferredTerm,
        avoidTerm: target.avoidTerm,
        hexCodes: target.hexCodes,
        fontFamily: target.fontFamily,
        publishImmediately: false,
      }).catch(() => {});
    } else {
      void publishKnowledgeEntry(id).catch(() => {});
    }
  };

  const addAsset = (asset: BrandAsset) => {
    const notice = getAssetPersistenceNotice(persistenceMode);
    setAssets((prev) => [asset, ...prev]);
    logActivity({
      actor: settings.reviewerName,
      action:
        notice.scope === "session_only"
          ? "added session brand asset:"
          : "uploaded brand asset:",
      target: asset.name,
      type: "asset_uploaded",
    });
    notify(
      `Added "${asset.name}" ${notice.addToastSuffix}`,
      notice.scope === "session_only" ? "info" : "success"
    );
  };

  const deleteAsset = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    notify("Asset removed from library", "info");
  };

  const updateSettings = (next: Partial<WorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    notify("Governance settings saved");
  };

  const resetDemoWorkspace = async () => {
    const activeIdentity = resolveActiveActorIdentity({
      viewerProfile,
      authUser: user,
    });
    if (persistenceMode === "SHARED_DEMO") {
      startSync();
      try {
        const res = await fetch("/api/demo/reset", { method: "POST" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Failed to reset sample data");
        }
        const [remoteReviews, remoteActivities] = await Promise.all([
          reviewRepo.fetchReviews(),
          activityRepo.fetchActivities(),
        ]);
        if (remoteReviews.length > 0) {
          setReviews(remoteReviews);
          setActiveReviewId(remoteReviews[0].id);
        }
        if (remoteActivities.length > 0) {
          setActivities(remoteActivities);
        }
        notify("Sample workspace data restored");
      } catch (err) {
        notify(err instanceof Error ? err.message : "Failed to reset sample data", "error");
      } finally {
        endSync();
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setReviews(INITIAL_REVIEWS);
      setAssets(TERALUNE_CURATED_DEMO_ASSETS);
      setActivities(INITIAL_ACTIVITY);
      setSettings({
        ...DEFAULT_SETTINGS,
        reviewerName: activeIdentity.name,
        reviewerRole: activeIdentity.role,
      });
      setActiveReviewId(INITIAL_REVIEWS[0].id);
      void refreshBrands();
      notify("Sample workspace data restored");
    }
  };

  const enterSharedDemoMode = useCallback(async () => {
    setDemoModePreference("shared");
    tenancyManager.reset();
    updatePersistenceStatus(false, false, true);
    setAssets((prev) => {
      const custom = prev.filter((a) => !a.isDemoFixture);
      return [...TERALUNE_CURATED_DEMO_ASSETS, ...custom];
    });
    startSync();
    try {
      const demoRev = new DemoReviewRepository();
      const demoAct = new DemoActivityRepository();
      setReviewRepo(demoRev);
      setActivityRepo(demoAct);
      const [remoteReviews, remoteActivities] = await Promise.all([
        demoRev.fetchReviews(),
        demoAct.fetchActivities(),
      ]);
      if (remoteReviews.length > 0) {
        setReviews(remoteReviews);
        setActiveReviewId(remoteReviews[0].id);
      }
      if (remoteActivities.length > 0) {
        setActivities(remoteActivities);
      }
      notify("Demo workspace ready", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Loaded demo workspace", "info");
    } finally {
      endSync();
    }
  }, [tenancyManager, notify, updatePersistenceStatus, startSync, endSync]);

  const enterLocalDemoMode = useCallback(() => {
    setDemoModePreference("local");
    tenancyManager.reset();
    updatePersistenceStatus(false, false, false);
    setReviewRepo(new LocalReviewRepository(INITIAL_REVIEWS));
    setActivityRepo(new LocalActivityRepository(INITIAL_ACTIVITY));
    setAssets((prev) => {
      const custom = prev.filter((a) => !a.isDemoFixture);
      return [...TERALUNE_CURATED_DEMO_ASSETS, ...custom];
    });
    notify("Switched to local workspace", "info");
  }, [tenancyManager, notify, updatePersistenceStatus]);

  // Display preference only: never overwrites viewer identity, auth state, or onboarding/tour status
  const setDemoPersona = useCallback((persona: DemoPersona) => {
    const resolved = resolveDemoPersonaConfig(persona);
    setDemoPersonaState(resolved.persona);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(DEMO_PERSONA_STORAGE_KEY, resolved.persona);
      } catch {
        // Ignore storage restrictions
      }
    }
  }, []);

  const enterTeraluneDemo = useCallback(
    async (options?: { persona?: DemoPersona }) => {
      const chosenPersona = resolveDemoPersonaConfig(
        options?.persona ?? demoPersona,
      );
      setDemoPersonaState(chosenPersona.persona);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(DEMO_PERSONA_STORAGE_KEY, chosenPersona.persona);
          localStorage.setItem(BRAND_STORAGE_KEY, TERALUNE_DEMO_BRAND_ID);
        } catch {
          // Ignore storage restrictions
        }
      }

      setViewerProfile((prev) => {
        const next: ViewerProfile = {
          ...prev,
          name: prev.name.trim() ? prev.name : "Guest Reviewer",
          role: prev.onboardingCompleted ? prev.role : chosenPersona.roleTitle,
          avatarId: prev.onboardingCompleted ? prev.avatarId : chosenPersona.avatarId,
          onboardingCompleted: true,
          guidedTourCompleted: prev.guidedTourCompleted,
          updatedAt: new Date().toISOString(),
        };
        saveViewerProfile(next);
        return next;
      });

      const hasSupabaseEnv = Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
      );
      if (hasSupabaseEnv) {
        await enterSharedDemoMode();
      } else {
        enterLocalDemoMode();
      }

      setSelectedBrandId(TERALUNE_DEMO_BRAND_ID);
      setSelectedBrandVersionId(LATEST_KNOWLEDGE_VERSION_ID);
      await loadKnowledgeForBrand(TERALUNE_DEMO_BRAND_ID);
    },
    [
      demoPersona,
      enterSharedDemoMode,
      enterLocalDemoMode,
      loadKnowledgeForBrand,
    ],
  );

  const completeOnboarding = useCallback(
    (input: {
      name: string;
      role?: string;
      avatarId: PresetAvatarId;
      customAvatarDataUrl?: string;
      startTour?: boolean;
    }) => {
      const nameCheck = validateViewerName(input.name);
      if (!nameCheck.valid) {
        return { success: false, error: nameCheck.error };
      }
      const cleanRole = normalizeViewerRole(input.role);
      const nextProfile: ViewerProfile = {
        name: nameCheck.normalized,
        role: cleanRole,
        avatarId: input.avatarId,
        customAvatarDataUrl: input.customAvatarDataUrl,
        onboardingCompleted: true,
        guidedTourCompleted: input.startTour === false,
        updatedAt: new Date().toISOString(),
      };
      setViewerProfile(nextProfile);
      saveViewerProfile(nextProfile);
      setSettings((prev) => ({
        ...prev,
        reviewerName: nextProfile.name,
        reviewerRole: nextProfile.role,
      }));
      if (input.startTour !== false) {
        setGuidedTourOpen(true);
      }
      notify(`Welcome to Identiq, ${nextProfile.name}`);
      return { success: true };
    },
    [notify]
  );

  const updateViewerProfile = useCallback(
    (patch: {
      name?: string;
      role?: string;
      avatarId?: PresetAvatarId;
      customAvatarDataUrl?: string | null;
    }) => {
      const nextNameRaw = patch.name !== undefined ? patch.name : viewerProfile.name;
      const nameCheck = validateViewerName(nextNameRaw);
      if (!nameCheck.valid) {
        return { success: false, error: nameCheck.error };
      }
      const nextRole =
        patch.role !== undefined ? normalizeViewerRole(patch.role) : viewerProfile.role;
      const nextCustomAvatar =
        patch.customAvatarDataUrl === null
          ? undefined
          : patch.customAvatarDataUrl !== undefined
          ? patch.customAvatarDataUrl
          : viewerProfile.customAvatarDataUrl;

      const nextProfile: ViewerProfile = {
        ...viewerProfile,
        name: nameCheck.normalized,
        role: nextRole,
        avatarId: patch.avatarId ?? viewerProfile.avatarId,
        customAvatarDataUrl: nextCustomAvatar,
        onboardingCompleted: true,
        updatedAt: new Date().toISOString(),
      };
      setViewerProfile(nextProfile);
      saveViewerProfile(nextProfile);
      setSettings((prev) => ({
        ...prev,
        reviewerName: nextProfile.name,
        reviewerRole: nextProfile.role,
      }));
      return { success: true };
    },
    [viewerProfile]
  );

  const markGuidedTourCompleted = useCallback(() => {
    setGuidedTourOpen(false);
    setViewerProfile((prev) => {
      if (!prev.onboardingCompleted) return prev;
      const next: ViewerProfile = {
        ...prev,
        guidedTourCompleted: true,
        updatedAt: new Date().toISOString(),
      };
      saveViewerProfile(next);
      return next;
    });
  }, []);

  const replayGuidedTour = useCallback(() => {
    setGuidedTourOpen(true);
  }, []);

  const selectedBrand =
    workspaceBrands.find((b) => b.brandId === selectedBrandId) ?? null;

  return (
    <IdentiqContext.Provider
      value={{
        hydrated,
        reviews,
        knowledge,
        workspaceBrands,
        selectedBrandId,
        selectedBrand,
        selectedBrandVersionId,
        versionSnapshots,
        knowledgeLoading,
        knowledgeMutating,
        knowledgeError,
        assets,
        activities,
        settings,
        activeReviewId,
        persistenceMode,
        isPersisted: persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO",
        isSyncing,
        organisationId,
        brandId,
        brandName,
        user,
        session,
        userRole,
        userOrganisations,
        signIn,
        signUp,
        signOut,
        createOrganisation,
        switchOrganisation,
        setAuthContext,
        reloadFromPersistence,
        refreshBrands,
        selectBrand,
        selectBrandVersion,
        createWorkspaceBrand,
        saveKnowledgeEntry,
        publishKnowledgeEntry,
        archiveKnowledgeEntry,
        getKnowledgeRequestContext,
        reloadSelectedBrandKnowledge,
        setActiveReviewId,
        addReview,
        updateReviewStatus,
        toggleFindingResolved,
        updateFindingCorrection,
        addFindingComment,
        updateFindingDecision,
        addManualFinding,
        upsertKnowledgeEntry,
        deleteKnowledgeEntry,
        toggleKnowledgeStatus,
        addAsset,
        deleteAsset,
        updateSettings,
        resetDemoWorkspace,
        enterSharedDemoMode,
        enterLocalDemoMode,
        enterTeraluneDemo,
        isDemoWorkspace:
          persistenceMode === "SHARED_DEMO" || persistenceMode === "DEMO_LOCAL",
        demoPersona,
        setDemoPersona,
        notify,
        viewerProfile,
        profileHydrated,
        guidedTourOpen,
        setGuidedTourOpen,
        completeOnboarding,
        updateViewerProfile,
        markGuidedTourCompleted,
        replayGuidedTour,
      }}
    >
      {children}

      {/* Non-intrusive bottom-right toast stack */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg border text-xs font-medium ${
              toast.tone === "error"
                ? "bg-[#2A1010] text-[#FFB4B4] border-red-500/30"
                : "bg-[#141414] text-white border-white/10"
            }`}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-[#CDEEE0] shrink-0" />
            ) : toast.tone === "error" ? (
              <ShieldAlert className="w-4 h-4 text-[#FF8585] shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-[#DDF0FA] shrink-0" />
            )}
            <span>{toast.text}</span>
            <button
              onClick={() => setToasts((p) => p.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss notification"
              className="ml-1 text-white/60 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </IdentiqContext.Provider>
  );
}

export function useIdentiq() {
  const ctx = useContext(IdentiqContext);
  if (!ctx) {
    throw new Error("useIdentiq must be used inside IdentiqProvider");
  }
  return ctx;
}
