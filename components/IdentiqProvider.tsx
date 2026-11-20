"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  ActivityEvent,
  BrandAsset,
  KnowledgeEntry,
  ReviewFinding,
  ReviewStatus,
  ReviewSubmission,
} from "@/lib/types";
import type { ReviewDecision } from "@/lib/contracts/workflow";
import {
  buildFindingDecisionPatch,
  getFindingDecisionValidationError,
} from "@/lib/review-decisions";
import {
  INITIAL_ACTIVITY,
  INITIAL_ASSETS,
  INITIAL_KNOWLEDGE,
  INITIAL_REVIEWS,
} from "@/lib/seed-data";
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
  reviews: ReviewSubmission[];
  knowledge: KnowledgeEntry[];
  assets: BrandAsset[];
  activities: ActivityEvent[];
  settings: WorkspaceSettings;
  activeReviewId: string;
  persistenceMode: PersistenceMode;
  isPersisted: boolean;
  isSyncing: boolean;
  organisationId: string | null;
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

const STORAGE_KEY = "identiq_workspace_v2";
const ORG_STORAGE_KEY = "identiq_org_id";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  reviewerName: FALLBACK_VIEWER_NAME,
  reviewerRole: DEFAULT_VIEWER_ROLE,
  autoFlagUnverified: true,
  strictClaimsMode: true,
  minimumApprovalScore: 85,
};

const IdentiqContext = createContext<IdentiqContextValue | null>(null);

export function IdentiqProvider({ children }: { children: React.ReactNode }) {
  const [reviews, setReviews] = useState<ReviewSubmission[]>(INITIAL_REVIEWS);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>(INITIAL_KNOWLEDGE);
  const [assets, setAssets] = useState<BrandAsset[]>(INITIAL_ASSETS);
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
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userOrganisations, setUserOrganisations] = useState<UserOrganisationMembership[]>([]);
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>("DEMO_LOCAL");
  const [isSyncing, setIsSyncing] = useState(false);
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

      try {
        const { session: activeSession } = await restoreSession();

        if (activeSession && !isCancelled) {
          setSession(activeSession);
          setUser(activeSession.user);

          // Retrieve membership under authenticated session & RLS
          const memberships = await fetchMemberships(activeSession.accessToken);
          if (isCancelled) return;
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
            setOrganisationId(chosenOrg);
            setUserRole(role);
            localStorage.setItem(ORG_STORAGE_KEY, chosenOrg);
            updatePersistenceStatus(true, true);

            // Fetch initial persisted data
            try {
              const supReviewRepo = new SupabaseReviewRepository();
              const supActivityRepo = new SupabaseActivityRepository();
              const [remoteReviews, remoteActivities] = await Promise.all([
                supReviewRepo.fetchReviews(chosenOrg),
                supActivityRepo.fetchActivities(chosenOrg, 100),
              ]);
              if (!isCancelled) {
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
            setOrganisationId(null);
            setUserRole(null);
            updatePersistenceStatus(true, false);
          }
        } else if (!isCancelled) {
          // No session or unauthenticated
          setSession(null);
          setUser(null);
          setOrganisationId(null);
          setUserRole(null);
          setUserOrganisations([]);

          const demoPref = getDemoModePreference();
          const shouldEnterSharedDemo =
            demoPref === "shared" || (demoPref !== "local" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL));

          if (shouldEnterSharedDemo) {
            updatePersistenceStatus(false, false, true);
            try {
              const demoRev = new DemoReviewRepository();
              const demoAct = new DemoActivityRepository();
              const [remoteReviews, remoteActivities] = await Promise.all([
                demoRev.fetchReviews(),
                demoAct.fetchActivities(),
              ]);
              if (!isCancelled) {
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
            if (saved) {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed.reviews) && parsed.reviews.length > 0) {
                setReviews(parsed.reviews);
                setActiveReviewId(parsed.reviews[0].id);
              }
              if (Array.isArray(parsed.knowledge)) setKnowledge(parsed.knowledge);
              if (Array.isArray(parsed.assets)) setAssets(parsed.assets);
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
        if (!isCancelled) {
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
        setOrganisationId(null);
        setUserRole(null);
        setUserOrganisations([]);
        localStorage.removeItem(ORG_STORAGE_KEY);
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
  }, [fetchMemberships, updatePersistenceStatus]);

  // Sync to localStorage in DEMO_LOCAL or CONFIGURED_UNAUTHENTICATED modes
  useEffect(() => {
    if (!hydrated) return;
    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") return;

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ reviews, knowledge, assets, activities, settings })
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
            knowledge,
            assets,
            activities,
            settings,
          })
        );
      } catch {
        // Ignore quota issues in restricted browsers
      }
    }
  }, [reviews, knowledge, assets, activities, settings, hydrated, persistenceMode]);

  // Load from Supabase when in AUTHENTICATED_SUPABASE or SHARED_DEMO mode
  const reloadFromPersistence = useCallback(async () => {
    if (persistenceMode !== "AUTHENTICATED_SUPABASE" && persistenceMode !== "SHARED_DEMO") return;
    setIsSyncing(true);
    try {
      if (persistenceMode === "SHARED_DEMO") {
        const [remoteReviews, remoteActivities] = await Promise.all([
          reviewRepo.fetchReviews(),
          activityRepo.fetchActivities(),
        ]);
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
        return;
      }

      let activeOrg = organisationId;
      if (!activeOrg) {
        const memRes = await callPostgrest<{ organisation_id: string }[]>(
          "/rest/v1/organisation_members?select=organisation_id&limit=1"
        );
        if (memRes.data && memRes.data.length > 0) {
          activeOrg = memRes.data[0].organisation_id;
          setOrganisationId(activeOrg);
          localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
        }
      }

      if (!activeOrg) {
        setIsSyncing(false);
        return;
      }

      const [remoteReviews, remoteActivities] = await Promise.all([
        reviewRepo.fetchReviews(activeOrg),
        activityRepo.fetchActivities(activeOrg, 100),
      ]);
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
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : "Failed to refresh workspace", "error");
    } finally {
      setIsSyncing(false);
    }
  }, [persistenceMode, organisationId, reviewRepo, activityRepo, activeReviewId, notify]);

  // Auth Operations
  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsSyncing(true);
      try {
        const res = await signInWithPassword({ email, password });
        if (res.error || !res.data) {
          notify(res.error?.message || "Invalid login credentials", "error");
          return { success: false, error: res.error?.message || "Invalid login credentials" };
        }

        const newSession = res.data.session;
        setSession(newSession);
        setUser(newSession.user);

        const memberships = await fetchMemberships(newSession.accessToken);
        setUserOrganisations(memberships);

        if (memberships.length > 0) {
          const activeOrg = memberships[0].organisation_id;
          const activeRole = memberships[0].role;
          setOrganisationId(activeOrg);
          setUserRole(activeRole);
          localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
          updatePersistenceStatus(true, true);

          try {
            const supReviewRepo = new SupabaseReviewRepository();
            const supActivityRepo = new SupabaseActivityRepository();
            const [remoteReviews, remoteActivities] = await Promise.all([
              supReviewRepo.fetchReviews(activeOrg),
              supActivityRepo.fetchActivities(activeOrg, 100),
            ]);
            if (remoteReviews.length > 0) {
              setReviews(remoteReviews);
              setActiveReviewId(remoteReviews[0].id);
            }
            if (remoteActivities.length > 0) {
              setActivities(remoteActivities);
            }
          } catch {
            // Ignore fetch failure
          }
          notify(`Signed in as ${newSession.user.email} (${activeRole})`);
        } else {
          setOrganisationId(null);
          setUserRole(null);
          updatePersistenceStatus(true, false);
          notify(
            `Signed in as ${newSession.user.email}. Create an organisation to persist reviews.`,
            "info"
          );
        }
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sign in failed";
        notify(msg, "error");
        return { success: false, error: msg };
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchMemberships, notify, updatePersistenceStatus]
  );

  const signUp = useCallback(
    async (email: string, password: string, metadata?: Record<string, unknown>) => {
      setIsSyncing(true);
      try {
        const res = await authSignUp({ email, password, metadata });
        if (res.error || !res.data) {
          notify(res.error?.message || "Sign up failed", "error");
          return { success: false, error: res.error?.message || "Sign up failed" };
        }

        if (res.data.session) {
          const newSession = res.data.session;
          setSession(newSession);
          setUser(newSession.user);
          const memberships = await fetchMemberships(newSession.accessToken);
          setUserOrganisations(memberships);

          if (memberships.length > 0) {
            const activeOrg = memberships[0].organisation_id;
            setOrganisationId(activeOrg);
            setUserRole(memberships[0].role);
            localStorage.setItem(ORG_STORAGE_KEY, activeOrg);
            updatePersistenceStatus(true, true);
          } else {
            setOrganisationId(null);
            setUserRole(null);
            updatePersistenceStatus(true, false);
          }
          notify(`Account created and signed in as ${res.data.user?.email}`);
        } else {
          notify("Account created. Please check your email to verify.", "info");
        }
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sign up failed";
        notify(msg, "error");
        return { success: false, error: msg };
      } finally {
        setIsSyncing(false);
      }
    },
    [fetchMemberships, notify, updatePersistenceStatus]
  );

  const signOut = useCallback(async () => {
    setIsSyncing(true);
    try {
      await authSignOut();
      setUser(null);
      setSession(null);
      setOrganisationId(null);
      setUserRole(null);
      setUserOrganisations([]);
      localStorage.removeItem(ORG_STORAGE_KEY);
      updatePersistenceStatus(false, false);
      notify("Signed out", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Error during sign out", "error");
    } finally {
      setIsSyncing(false);
    }
  }, [notify, updatePersistenceStatus]);

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

      setIsSyncing(true);
      try {
        const res = await callPostgrest<{ organisation_id: string; name: string; role: string }>(
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
        const newRole = res.data.role;
        setOrganisationId(newOrgId);
        setUserRole(newRole);
        localStorage.setItem(ORG_STORAGE_KEY, newOrgId);
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
        setIsSyncing(false);
      }
    },
    [session, notify, updatePersistenceStatus]
  );

  const switchOrganisation = useCallback(
    async (orgId: string) => {
      const match = userOrganisations.find((o) => o.organisation_id === orgId);
      if (!match) {
        notify("You are not a member of that organisation", "error");
        return;
      }
      setOrganisationId(orgId);
      setUserRole(match.role);
      localStorage.setItem(ORG_STORAGE_KEY, orgId);
      updatePersistenceStatus(true, true);
      notify(`Switched organisation`);
      setTimeout(() => {
        reloadFromPersistence();
      }, 50);
    },
    [userOrganisations, notify, updatePersistenceStatus, reloadFromPersistence]
  );

  // Set Auth and Tenancy context
  const setAuthContext = useCallback(
    (token: string | null, orgId: string | null) => {
      setClientAuthToken(token);
      if (orgId) {
        localStorage.setItem(ORG_STORAGE_KEY, orgId);
      } else {
        localStorage.removeItem(ORG_STORAGE_KEY);
      }
      setOrganisationId(orgId);
      updatePersistenceStatus(Boolean(token), Boolean(orgId));
    },
    [updatePersistenceStatus]
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
  const addReview = async (review: ReviewSubmission, brandId?: string) => {
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
          organisationId: organisationId || "e0000000-0000-0000-0000-000000000001",
          brandId: brandId || "b0000000-0000-0000-0000-000000000001",
        });
        notify(`"${review.title}" submitted for review`);
      } catch (err: unknown) {
        // Rollback optimistic state
        setReviews(prevReviews);
        setActivities(prevActivities);
        notify(err instanceof Error ? err.message : "Failed to save review submission", "error");
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

    if (persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO") {
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

  // Client-state workflows for Aditi (Knowledge & Assets preserved untouched)
  const upsertKnowledgeEntry = (entry: KnowledgeEntry) => {
    const exists = knowledge.some((k) => k.id === entry.id);
    setKnowledge((prev) =>
      exists ? prev.map((k) => (k.id === entry.id ? entry : k)) : [entry, ...prev]
    );
    logActivity({
      actor: settings.reviewerName,
      action: exists ? "updated knowledge entry:" : "added knowledge entry:",
      target: entry.title,
      type: "knowledge_updated",
    });
    notify(exists ? "Knowledge entry updated" : "Knowledge entry added");
  };

  const deleteKnowledgeEntry = (id: string) => {
    setKnowledge((prev) => prev.filter((k) => k.id !== id));
    notify("Knowledge entry removed", "info");
  };

  const toggleKnowledgeStatus = (id: string) => {
    setKnowledge((prev) =>
      prev.map((k) =>
        k.id === id
          ? {
              ...k,
              status: k.status === "Approved" ? "Pending Review" : "Approved",
              updatedAt: new Date().toISOString().split("T")[0],
            }
          : k
      )
    );
    notify("Knowledge verification status updated");
  };

  const addAsset = (asset: BrandAsset) => {
    setAssets((prev) => [asset, ...prev]);
    logActivity({
      actor: settings.reviewerName,
      action: "uploaded brand asset:",
      target: asset.name,
      type: "asset_uploaded",
    });
    notify(`Added "${asset.name}" to Asset Library`);
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
      setIsSyncing(true);
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
        setIsSyncing(false);
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setReviews(INITIAL_REVIEWS);
      setKnowledge(INITIAL_KNOWLEDGE);
      setAssets(INITIAL_ASSETS);
      setActivities(INITIAL_ACTIVITY);
      setSettings({
        ...DEFAULT_SETTINGS,
        reviewerName: activeIdentity.name,
        reviewerRole: activeIdentity.role,
      });
      setActiveReviewId(INITIAL_REVIEWS[0].id);
      notify("Sample workspace data restored");
    }
  };

  const enterSharedDemoMode = useCallback(async () => {
    setDemoModePreference("shared");
    updatePersistenceStatus(false, false, true);
    setIsSyncing(true);
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
      setIsSyncing(false);
    }
  }, [notify, updatePersistenceStatus]);

  const enterLocalDemoMode = useCallback(() => {
    setDemoModePreference("local");
    updatePersistenceStatus(false, false, false);
    setReviewRepo(new LocalReviewRepository(INITIAL_REVIEWS));
    setActivityRepo(new LocalActivityRepository(INITIAL_ACTIVITY));
    notify("Switched to local workspace", "info");
  }, [notify, updatePersistenceStatus]);

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

  return (
    <IdentiqContext.Provider
      value={{
        reviews,
        knowledge,
        assets,
        activities,
        settings,
        activeReviewId,
        persistenceMode,
        isPersisted: persistenceMode === "AUTHENTICATED_SUPABASE" || persistenceMode === "SHARED_DEMO",
        isSyncing,
        organisationId,
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
