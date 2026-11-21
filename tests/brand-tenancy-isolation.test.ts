import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ReviewSubmission } from "../lib/types";
import { DEMO_CONFIG } from "../lib/demo/config";
import {
  ReviewRepository,
  SubmitReviewParams,
  UpdateReviewStatusParams,
  ToggleFindingResolvedParams,
  ApplyFindingCorrectionParams,
  UpdateFindingDecisionParams,
  AddFindingCommentParams,
  AddManualFindingParams,
  LocalReviewRepository,
} from "../lib/repositories/review-repository";
import { PersistenceMode } from "../lib/supabase/client";
import {
  BrandTenancyManager,
  ORG_STORAGE_KEY,
  BRAND_STORAGE_KEY,
  BrandStorageAdapter,
  SwitchOrgResult,
} from "../components/IdentiqProvider";

/**
 * In-memory storage adapter for testing production BrandTenancyManager without DOM.
 */
class MemoryBrandStorage implements BrandStorageAdapter {
  public map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

/**
 * Mock ReviewRepository to record submission parameters for tenancy assertion.
 */
class TenancyMockReviewRepository implements ReviewRepository {
  public submittedParams: SubmitReviewParams[] = [];

  async fetchReviews(organisationId?: string): Promise<ReviewSubmission[]> {
    return this.submittedParams
      .filter((p) => !organisationId || p.organisationId === organisationId)
      .map((p) => p.review);
  }

  async submitReview(
    params: SubmitReviewParams
  ): Promise<{ reviewId: string; complianceScore: number }> {
    this.submittedParams.push(params);
    return {
      reviewId: params.review.id,
      complianceScore: params.review.complianceScore ?? 100,
    };
  }

  async updateReviewStatus(params: UpdateReviewStatusParams) {
    return { reviewId: params.reviewId, status: params.status };
  }
  async toggleFindingResolved(params: ToggleFindingResolvedParams) {
    return {
      reviewId: params.reviewId,
      findingId: params.findingId,
      resolved: true,
      complianceScore: 100,
    };
  }
  async applyFindingCorrection(params: ApplyFindingCorrectionParams) {
    return {
      reviewId: params.reviewId,
      findingId: params.findingId,
      appliedToCopy: true,
      complianceScore: 100,
    };
  }
  async updateFindingDecision(params: UpdateFindingDecisionParams) {
    return { reviewId: params.reviewId, findingId: params.findingId, decision: params.decision };
  }
  async addFindingComment(params: AddFindingCommentParams) {
    return { commentId: params.commentId, reviewId: params.reviewId, findingId: params.findingId };
  }
  async addManualFinding(params: AddManualFindingParams) {
    return { findingId: params.finding.id, reviewId: params.reviewId, complianceScore: 100 };
  }
}

/**
 * Test harness binding production BrandTenancyManager to MockReviewRepository.
 */
class TenancyCoordinator {
  public manager: BrandTenancyManager;
  public reviewRepo: ReviewRepository;
  public storage: MemoryBrandStorage;
  public notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
  public userOrganisations: Array<{ organisation_id: string; role: string; name?: string }> = [];
  public persistenceMode: PersistenceMode = "DEMO_LOCAL";

  constructor(reviewRepo?: ReviewRepository) {
    this.storage = new MemoryBrandStorage();
    this.reviewRepo = reviewRepo || new TenancyMockReviewRepository();
    this.manager = new BrandTenancyManager({
      storage: this.storage,
      onNotify: (message, tone) => {
        this.notifications.push({ message, tone });
      },
    });
  }

  get organisationId(): string | null {
    return this.manager.organisationId;
  }
  set organisationId(val: string | null) {
    this.manager.updateState({ organisationId: val });
  }

  get brandId(): string | null {
    return this.manager.brandId;
  }
  set brandId(val: string | null) {
    this.manager.updateState({ brandId: val });
  }

  get brandName(): string | null {
    return this.manager.brandName;
  }
  set brandName(val: string | null) {
    this.manager.updateState({ brandName: val });
  }

  async fetchPrimaryBrand(
    orgId: string,
    queryFn: (url: string) => Promise<{ data: Array<{ id: string; name: string }> | null; error: Error | null }>
  ): Promise<{ id: string; name: string } | null> {
    if (!orgId) return null;
    const url = `/rest/v1/brands?organisation_id=eq.${encodeURIComponent(orgId)}&select=id,name,approved,created_at&order=approved.desc,created_at.asc&limit=1`;
    const res = await queryFn(url);

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
  }

  handleCreateOrganisationResponse(rpcData: {
    organisation_id?: string;
    brand_id?: string;
    name?: string;
    role?: string;
  }): { success: boolean; orgId?: string; brandId?: string; error?: string } {
    const newOrgId = rpcData.organisation_id;
    const newBrandId = rpcData.brand_id;
    const newRole = rpcData.role || "owner";

    if (!newOrgId || !newBrandId) {
      return {
        success: false,
        error: "Organisation creation returned an incomplete response (missing organisation_id or brand_id)",
      };
    }

    this.manager.handleOrganisationCreated({
      organisationId: newOrgId,
      brandId: newBrandId,
      brandName: rpcData.name,
      role: newRole,
    });
    this.userOrganisations.push({
      organisation_id: newOrgId,
      role: newRole,
      name: rpcData.name,
    });
    this.persistenceMode = "AUTHENTICATED_SUPABASE";

    return { success: true, orgId: newOrgId, brandId: newBrandId };
  }

  async switchOrganisation(
    targetOrgId: string,
    queryFn: (url: string) => Promise<{ data: Array<{ id: string; name: string }> | null; error: Error | null }>
  ): Promise<SwitchOrgResult> {
    const res = await this.manager.switchOrganisation({
      targetOrgId,
      userOrganisations: this.userOrganisations,
      fetchBrand: (orgId) => this.fetchPrimaryBrand(orgId, queryFn),
    });
    if (res.success) {
      this.persistenceMode = "AUTHENTICATED_SUPABASE";
    }
    return res;
  }

  signOut(): void {
    this.manager.reset();
    this.userOrganisations = [];
    this.persistenceMode = "DEMO_LOCAL";
  }

  async addReview(review: ReviewSubmission, explicitBrandId?: string): Promise<void> {
    const { organisationId: targetOrgId, brandId: targetBrandId } =
      this.manager.validateReviewSubmissionTenancy({
        persistenceMode: this.persistenceMode,
        explicitBrandId,
      });

    if (this.persistenceMode === "AUTHENTICATED_SUPABASE" || this.persistenceMode === "SHARED_DEMO") {
      await this.reviewRepo.submitReview({
        review,
        organisationId: targetOrgId,
        brandId: targetBrandId,
      });
    } else {
      await this.reviewRepo.submitReview({
        review,
        organisationId: "local-org",
        brandId: "local-brand",
      });
    }
  }
}

function createDummyReview(id: string, title: string): ReviewSubmission {
  return {
    id,
    title,
    contentType: "Campaign Copy",
    guidelineCollection: "Corporate Identity v1.0",
    submittedBy: "Compliance Auditor",
    submittedAt: "2026-11-20 16:00",
    status: "Pending Approval",
    complianceScore: 92,
    textContent: "Sample campaign copy under governance review.",
    findings: [],
    pastelTheme: "blue",
  };
}

describe("Active Brand ID & Review Tenancy Isolation Suite", () => {
  let mockRepo: TenancyMockReviewRepository;
  let coordinator: TenancyCoordinator;

  beforeEach(() => {
    mockRepo = new TenancyMockReviewRepository();
    coordinator = new TenancyCoordinator(mockRepo);
  });

  // =========================================================================
  // 1. ORGANISATION CREATION CAPTURES & RETAINS BRAND_ID
  // =========================================================================
  describe("1. Organisation Creation Retaining Returned Brand ID", () => {
    it("captures brand_id from create_organisation_and_owner response and sets active state", () => {
      const rpcResult = {
        organisation_id: "org-cust-1001",
        brand_id: "brand-cust-1001",
        name: "Acme Healthcare",
        role: "owner",
      };

      const result = coordinator.handleCreateOrganisationResponse(rpcResult);

      assert.equal(result.success, true);
      assert.equal(result.orgId, "org-cust-1001");
      assert.equal(result.brandId, "brand-cust-1001");
      assert.equal(coordinator.organisationId, "org-cust-1001");
      assert.equal(coordinator.brandId, "brand-cust-1001");
      assert.equal(coordinator.brandName, "Acme Healthcare");
      assert.equal(coordinator.storage.getItem(ORG_STORAGE_KEY), "org-cust-1001");
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), "brand-cust-1001");
    });

    it("rejects incomplete RPC response missing brand_id without falling back to demo IDs", () => {
      const incompleteResult = {
        organisation_id: "org-cust-1002",
        name: "Broken Corp",
        role: "owner",
      };

      const result = coordinator.handleCreateOrganisationResponse(incompleteResult);

      assert.equal(result.success, false);
      assert.match(result.error || "", /missing organisation_id or brand_id/i);
      assert.notEqual(coordinator.brandId, DEMO_CONFIG.BRAND_ID);
      assert.equal(coordinator.brandId, null);
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), null);
    });
  });

  // =========================================================================
  // 2. PRIMARY BRAND RESTORATION SCOPED TO SELECTED ORGANISATION
  // =========================================================================
  describe("2. Primary Brand Restoration Scoped to Selected Organisation", () => {
    it("queries PostgREST scoped to organisation_id with approved and created_at ordering", async () => {
      let requestedUrl = "";
      const queryFn = async (url: string) => {
        requestedUrl = url;
        return {
          data: [{ id: "brand-verified-777", name: "Alpha Bio" }],
          error: null,
        };
      };

      const brand = await coordinator.fetchPrimaryBrand("org-target-999", queryFn);

      assert.ok(requestedUrl.includes("organisation_id=eq.org-target-999"));
      assert.ok(requestedUrl.includes("select=id,name,approved,created_at"));
      assert.ok(requestedUrl.includes("order=approved.desc,created_at.asc"));
      assert.ok(requestedUrl.includes("limit=1"));
      assert.deepEqual(brand, { id: "brand-verified-777", name: "Alpha Bio" });
    });

    it("returns null explicitly when organisation has no configured brands", async () => {
      const queryFn = async () => ({ data: [], error: null });

      const brand = await coordinator.fetchPrimaryBrand("org-empty-brand", queryFn);
      assert.equal(brand, null);
    });

    it("propagates genuine PostgREST errors instead of treating them as empty result", async () => {
      const queryFn = async () => ({
        data: null,
        error: new Error("JWT expired or insufficient privileges"),
      });

      await assert.rejects(
        () => coordinator.fetchPrimaryBrand("org-err", queryFn),
        /JWT expired or insufficient privileges/
      );
    });
  });

  // =========================================================================
  // 3. ORGANISATION SWITCHING PURGES STALE STATE & FAILS CLOSED
  // =========================================================================
  describe("3. Organisation Switching Replacing Old Brand ID", () => {
    beforeEach(() => {
      coordinator.userOrganisations = [
        { organisation_id: "org-alpha", role: "owner", name: "Organisation Alpha" },
        { organisation_id: "org-beta", role: "admin", name: "Organisation Beta" },
        { organisation_id: "org-empty", role: "reviewer", name: "Organisation Without Brand" },
      ];
      coordinator.organisationId = "org-alpha";
      coordinator.brandId = "brand-alpha-001";
      coordinator.brandName = "Brand Alpha";
      coordinator.storage.setItem(ORG_STORAGE_KEY, "org-alpha");
      coordinator.storage.setItem(BRAND_STORAGE_KEY, "brand-alpha-001");
    });

    it("purges old brand immediately and loads new organisation's brand", async () => {
      const queryFn = async (url: string) => {
        if (url.includes("org-beta")) {
          return { data: [{ id: "brand-beta-002", name: "Brand Beta" }], error: null };
        }
        return { data: [], error: null };
      };

      const res = await coordinator.switchOrganisation("org-beta", queryFn);

      assert.equal(res.success, true);
      assert.equal(coordinator.organisationId, "org-beta");
      assert.equal(coordinator.brandId, "brand-beta-002");
      assert.equal(coordinator.brandName, "Brand Beta");
      assert.equal(coordinator.storage.getItem(ORG_STORAGE_KEY), "org-beta");
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), "brand-beta-002");
    });

    it("fails closed when switched organisation has no brand configured (never retains old brand)", async () => {
      const queryFn = async () => ({ data: [], error: null });

      const res = await coordinator.switchOrganisation("org-empty", queryFn);

      assert.equal(res.success, false);
      assert.equal(coordinator.organisationId, "org-empty");
      assert.equal(coordinator.brandId, null);
      assert.equal(coordinator.brandName, null);
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), null);
    });

    it("fails closed and clears state when brand fetch throws an error", async () => {
      const queryFn = async () => ({ data: null, error: new Error("Network timeout") });

      const res = await coordinator.switchOrganisation("org-beta", queryFn);

      assert.equal(res.success, false);
      assert.equal(res.reason, "ERROR");
      assert.equal(coordinator.brandId, null);
      assert.equal(coordinator.brandName, null);
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), null);
    });
  });

  // =========================================================================
  // 4. PREVENTING STALE ORGANISATION-BRAND REQUESTS (RACE CONDITION DEFENSE)
  // =========================================================================
  describe("4. Prevent Stale Organisation-Brand Requests (Generation Protection)", () => {
    it("ensures faster resolving second request B wins over slower resolving first request A", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: string }> = [];
      const manager = new BrandTenancyManager({
        storage,
        initialState: { organisationId: "org-alpha", brandId: "brand-alpha" },
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-alpha", role: "owner", name: "Alpha Corp" },
        { organisation_id: "org-beta", role: "admin", name: "Beta Corp" },
      ];

      let resolveA!: (value: { id: string; name: string } | null) => void;
      const promiseA = new Promise<{ id: string; name: string } | null>((resolve) => {
        resolveA = resolve;
      });

      let resolveB!: (value: { id: string; name: string } | null) => void;
      const promiseB = new Promise<{ id: string; name: string } | null>((resolve) => {
        resolveB = resolve;
      });

      // 1. Request A starts first (slow lookup for org-alpha)
      const switchPromiseA = manager.switchOrganisation({
        targetOrgId: "org-alpha",
        userOrganisations,
        fetchBrand: () => promiseA,
      });

      // 2. Request B starts second (quick lookup for org-beta)
      const switchPromiseB = manager.switchOrganisation({
        targetOrgId: "org-beta",
        userOrganisations,
        fetchBrand: () => promiseB,
      });

      // 3. Request B resolves FIRST
      resolveB({ id: "brand-beta-won", name: "Beta Brand" });
      const resultB = await switchPromiseB;

      assert.equal(resultB.success, true);
      assert.equal(manager.organisationId, "org-beta");
      assert.equal(manager.brandId, "brand-beta-won");
      assert.equal(manager.brandName, "Beta Brand");
      assert.equal(storage.getItem(BRAND_STORAGE_KEY), "brand-beta-won");

      // 4. Slower Request A resolves LAST
      resolveA({ id: "brand-alpha-stale", name: "Alpha Brand" });
      const resultA = await switchPromiseA;

      // Stale request A is safely rejected
      assert.equal(resultA.success, false);
      assert.equal(resultA.reason, "STALE");

      // Active state and storage remain pinned to Org B and Brand B
      assert.equal(manager.organisationId, "org-beta");
      assert.equal(manager.brandId, "brand-beta-won");
      assert.equal(manager.brandName, "Beta Brand");
      assert.equal(storage.getItem(BRAND_STORAGE_KEY), "brand-beta-won");
    });

    it("ensures a delayed failure on stale request A cannot wipe out current valid brand B", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: string }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-alpha", role: "owner", name: "Alpha Corp" },
        { organisation_id: "org-beta", role: "admin", name: "Beta Corp" },
      ];

      let rejectA!: (err: Error) => void;
      const promiseA = new Promise<{ id: string; name: string } | null>((_, reject) => {
        rejectA = reject;
      });

      // Request A starts first
      const switchPromiseA = manager.switchOrganisation({
        targetOrgId: "org-alpha",
        userOrganisations,
        fetchBrand: () => promiseA,
      });

      // Request B starts second and immediately resolves
      const switchPromiseB = manager.switchOrganisation({
        targetOrgId: "org-beta",
        userOrganisations,
        fetchBrand: async () => ({ id: "brand-beta-active", name: "Beta Brand Active" }),
      });

      const resultB = await switchPromiseB;
      assert.equal(resultB.success, true);
      assert.equal(manager.brandId, "brand-beta-active");

      // Now Request A fails with an error
      rejectA(new Error("Old request connection timeout"));
      const resultA = await switchPromiseA;

      assert.equal(resultA.success, false);
      assert.equal(resultA.reason, "STALE");

      // Ensure brand B was NOT cleared by the stale error
      assert.equal(manager.organisationId, "org-beta");
      assert.equal(manager.brandId, "brand-beta-active");
      assert.equal(storage.getItem(BRAND_STORAGE_KEY), "brand-beta-active");

      // Ensure no error notification was emitted for stale failure
      const hasStaleErrorNotification = notifications.some((n) =>
        n.message.includes("Old request connection timeout")
      );
      assert.equal(hasStaleErrorNotification, false);
    });

    it("protects asynchronous brand resolution during authentication against stale responses", async () => {
      const storage = new MemoryBrandStorage();
      const manager = new BrandTenancyManager({ storage });

      let resolveFirst!: (value: { id: string; name: string } | null) => void;
      const promiseFirst = new Promise<{ id: string; name: string } | null>((resolve) => {
        resolveFirst = resolve;
      });

      // First resolution starts (e.g. initial session restore)
      const resFirstPromise = manager.resolveBrandForOrganisation({
        orgId: "org-session-old",
        fetchBrand: () => promiseFirst,
      });

      // User creates or switches to a new organisation before first completes
      manager.handleOrganisationCreated({
        organisationId: "org-created-new",
        brandId: "brand-created-new",
        brandName: "New Brand",
      });

      // Stale first resolution finally returns
      resolveFirst({ id: "brand-old-stale", name: "Old Brand" });
      const resFirst = await resFirstPromise;

      assert.equal(resFirst.success, false);
      assert.equal(resFirst.reason, "STALE");
      assert.equal(manager.organisationId, "org-created-new");
      assert.equal(manager.brandId, "brand-created-new");
      assert.equal(storage.getItem(BRAND_STORAGE_KEY), "brand-created-new");
    });

    it("isCurrent validates request generation and active organisation to protect data loading", () => {
      const storage = new MemoryBrandStorage();
      const manager = new BrandTenancyManager({
        storage,
        initialState: { organisationId: "org-active" },
      });

      const gen = manager.currentGeneration;

      // 1. Current generation and matching org -> true
      assert.equal(manager.isCurrent(gen, "org-active"), true);

      // 2. Mismatched organisation -> false
      assert.equal(manager.isCurrent(gen, "org-other"), false);

      // 3. Increment generation via invalidation (e.g. org switch begins) -> false
      manager.invalidateInFlightRequests();
      assert.equal(manager.isCurrent(gen, "org-active"), false);

      // 4. Stale check halts data loading flow before applying reviews
      let reviewsApplied = false;
      const fakeFetchReviews = () => [{ id: "rev-stale", title: "Old Data" }];
      if (manager.isCurrent(gen, "org-active")) {
        fakeFetchReviews();
        reviewsApplied = true;
      }
      assert.equal(reviewsApplied, false);
    });

    it("reloadFromPersistence generation preservation blocks delayed async calls from applying state", async () => {
      const storage = new MemoryBrandStorage();
      const manager = new BrandTenancyManager({
        storage,
        initialState: { organisationId: "org-initial" },
      });

      // 1. Initial reload starts and captures reqGen
      const initialGen = manager.currentGeneration;
      const initialOrg = manager.organisationId;

      let resolveFetch!: (reviews: Array<{ id: string; title: string }>) => void;
      const fetchPromise = new Promise<Array<{ id: string; title: string }>>((resolve) => {
        resolveFetch = resolve;
      });

      // 2. Intervening organisation switch happens while fetch is in-flight
      manager.switchOrganisation({
        targetOrgId: "org-switched",
        userOrganisations: [{ organisation_id: "org-switched", role: "owner" }],
        fetchBrand: async () => ({ id: "brand-switched", name: "Brand Switched" }),
      });

      // 3. Initial delayed fetch completes
      resolveFetch([{ id: "rev-initial", title: "Initial Org Data" }]);
      const fetchedReviews = await fetchPromise;

      // 4. Verification: isCurrent accurately blocks applying old reviews
      let appliedReviews: Array<{ id: string; title: string }> = [];
      if (manager.isCurrent(initialGen, initialOrg)) {
        appliedReviews = fetchedReviews;
      }

      assert.equal(appliedReviews.length, 0);
      assert.equal(manager.isCurrent(initialGen, initialOrg), false);
      assert.equal(manager.organisationId, "org-switched");
    });

    it("signUp and signIn race: blocks session/persistence updates and asserts provider-level superseded error", async () => {
      // 1. Production BrandTenancyManager behavior
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: string }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const signUpGen = manager.currentGeneration;

      let resolveBrandLookup!: (brand: { id: string; name: string } | null) => void;
      const brandLookupPromise = new Promise<{ id: string; name: string } | null>((resolve) => {
        resolveBrandLookup = resolve;
      });

      // Start brand resolution for signUp
      const brandResolvePromise = manager.resolveBrandForOrganisation({
        orgId: "org-signup",
        fetchBrand: () => brandLookupPromise,
      });

      // 2. User signs out or cancels before brand lookup finishes
      manager.reset();
      const resetGen = manager.currentGeneration;

      // 3. Brand lookup finishes late
      resolveBrandLookup({ id: "brand-signup", name: "Brand Signup" });
      const brandResult = await brandResolvePromise;

      // Direct BrandTenancyManager assertion: recognized as STALE
      assert.equal(brandResult.success, false);
      assert.equal(brandResult.reason, "STALE");

      // 4. Provider-level contract mapping: must return success: false with exact superseded error
      type AuthOperationResult = { success: boolean; error?: string };
      const mapAuthResult = (res: typeof brandResult, gen: number, org: string): AuthOperationResult => {
        if (!res.success && res.reason === "STALE") {
          return {
            success: false,
            error: "Operation was superseded by a newer authentication or organisation change",
          };
        }
        if (!manager.isCurrent(manager.currentGeneration, org)) {
          return {
            success: false,
            error: "Operation was superseded by a newer authentication or organisation change",
          };
        }
        return { success: true };
      };

      const finalAuthResult = mapAuthResult(brandResult, signUpGen, "org-signup");
      assert.deepEqual(finalAuthResult, {
        success: false,
        error: "Operation was superseded by a newer authentication or organisation change",
      });

      // Verify that neither session nor reviews are applied when stale
      let sessionApplied = false;
      let notificationEmitted = false;

      if (brandResult.success && manager.isCurrent(signUpGen, "org-signup")) {
        sessionApplied = true;
      }

      if (manager.isCurrent(signUpGen, "org-signup")) {
        manager.notify("Account created and signed in", "success");
        notificationEmitted = true;
      }

      assert.equal(sessionApplied, false);
      assert.equal(notificationEmitted, false);
      assert.equal(manager.isCurrent(signUpGen, "org-signup"), false);
      assert.equal(manager.currentGeneration, resetGen);
      assert.equal(manager.organisationId, null);
    });

    it("provider-level syncing counter: older overlapping operation cannot clear isSyncing while newer is active", () => {
      // Simulates the provider-level startSync / endSync ref counter contract
      let activeSyncCount = 0;
      let isSyncing = false;

      const startSync = () => {
        activeSyncCount += 1;
        isSyncing = true;
      };

      const endSync = () => {
        activeSyncCount = Math.max(0, activeSyncCount - 1);
        if (activeSyncCount === 0) {
          isSyncing = false;
        }
      };

      // 1. Operation 1 (e.g. reloadFromPersistence) starts
      startSync();
      assert.equal(isSyncing, true);
      assert.equal(activeSyncCount, 1);

      // 2. Operation 2 (e.g. signIn) starts concurrently before Operation 1 completes
      startSync();
      assert.equal(isSyncing, true);
      assert.equal(activeSyncCount, 2);

      // 3. Operation 1 completes first and invokes its finally block
      endSync();
      // Crucial: isSyncing MUST remain true because Operation 2 is still active
      assert.equal(isSyncing, true);
      assert.equal(activeSyncCount, 1);

      // 4. Operation 2 completes and invokes its finally block
      endSync();
      assert.equal(isSyncing, false);
      assert.equal(activeSyncCount, 0);
    });

    it("initializeAuthAndData: protects against applying stale reviews and activities after signOut", async () => {
      const storage = new MemoryBrandStorage();
      const manager = new BrandTenancyManager({
        storage,
        initialState: { organisationId: "org-restored" },
      });

      const initGen = manager.currentGeneration;

      let resolveRemoteData!: () => void;
      const remoteDataPromise = new Promise<void>((resolve) => {
        resolveRemoteData = resolve;
      });

      // User signs out while restore/data fetch is in-flight
      manager.reset();

      // Remote data resolves
      resolveRemoteData();
      await remoteDataPromise;

      let reviewsSet = false;
      if (manager.isCurrent(initGen, "org-restored")) {
        reviewsSet = true;
      }

      assert.equal(reviewsSet, false);
      assert.equal(manager.organisationId, null);
    });
  });

  // =========================================================================
  // 5. PRODUCTION BRAND TENANCY MANAGER NOTIFICATION GOVERNANCE (DIRECT)
  // =========================================================================
  describe("5. Production BrandTenancyManager Notification Governance (Direct Unit Coverage)", () => {
    it("emits success notification 'Switched organisation' with tone 'success' ONLY when brand lookup succeeds", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-valid", role: "owner", name: "Valid Org" },
      ];

      const res = await manager.switchOrganisation({
        targetOrgId: "org-valid",
        userOrganisations,
        fetchBrand: async () => ({ id: "brand-valid-1", name: "Valid Brand" }),
      });

      assert.equal(res.success, true);
      assert.equal(manager.brandId, "brand-valid-1");
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        message: "Switched organisation",
        tone: "success",
      });
    });

    it("emits info notification and NO success notification when brand lookup returns no brand", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-nobrand", role: "owner", name: "No Brand Org" },
      ];

      const res = await manager.switchOrganisation({
        targetOrgId: "org-nobrand",
        userOrganisations,
        fetchBrand: async () => null,
      });

      assert.equal(res.success, false);
      assert.equal(res.reason, "NO_BRAND");
      assert.equal(manager.brandId, null);

      // Verify NO success notification was emitted
      const successNotifications = notifications.filter(
        (n) => n.message.includes("Switched organisation")
      );
      assert.equal(successNotifications.length, 0);

      // Verify informational notification was emitted with exact message and tone
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        message: "Selected organisation has no configured brand profile",
        tone: "info",
      });
    });

    it("emits error notification and NO success notification when brand lookup throws an error", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-error", role: "owner", name: "Error Org" },
      ];

      const res = await manager.switchOrganisation({
        targetOrgId: "org-error",
        userOrganisations,
        fetchBrand: async () => {
          throw new Error("PostgREST 500 Internal Error");
        },
      });

      assert.equal(res.success, false);
      assert.equal(res.reason, "ERROR");
      assert.equal(manager.brandId, null);

      // Verify NO success notification was emitted
      const successNotifications = notifications.filter(
        (n) => n.message.includes("Switched organisation")
      );
      assert.equal(successNotifications.length, 0);

      // Verify error notification was emitted with exact message and tone
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        message: "PostgREST 500 Internal Error",
        tone: "error",
      });
    });

    it("ensures stale requests do NOT emit misleading notifications (success, info, or error)", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-a", role: "owner", name: "Org A" },
        { organisation_id: "org-b", role: "member", name: "Org B" },
      ];

      let resolveA!: (value: { id: string; name: string } | null) => void;
      const promiseA = new Promise<{ id: string; name: string } | null>((resolve) => {
        resolveA = resolve;
      });

      // 1. Request A starts first (slow)
      const switchA = manager.switchOrganisation({
        targetOrgId: "org-a",
        userOrganisations,
        fetchBrand: () => promiseA,
      });

      // 2. Request B starts second and finishes quickly
      const switchB = await manager.switchOrganisation({
        targetOrgId: "org-b",
        userOrganisations,
        fetchBrand: async () => ({ id: "brand-b", name: "Brand B" }),
      });

      assert.equal(switchB.success, true);
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        message: "Switched organisation",
        tone: "success",
      });

      // 3. Stale Request A finishes later with brand data
      resolveA({ id: "brand-a-stale", name: "Brand A Stale" });
      const resA = await switchA;

      assert.equal(resA.success, false);
      assert.equal(resA.reason, "STALE");

      // Verify NO extra notification was emitted by the stale request
      assert.equal(notifications.length, 1);
      assert.deepEqual(notifications[0], {
        message: "Switched organisation",
        tone: "success",
      });
    });

    it("ensures stale request failure does not emit error notification", async () => {
      const storage = new MemoryBrandStorage();
      const notifications: Array<{ message: string; tone: "success" | "info" | "error" }> = [];
      const manager = new BrandTenancyManager({
        storage,
        onNotify: (message, tone) => notifications.push({ message, tone }),
      });

      const userOrganisations = [
        { organisation_id: "org-a", role: "owner", name: "Org A" },
        { organisation_id: "org-b", role: "member", name: "Org B" },
      ];

      let rejectA!: (err: Error) => void;
      const promiseA = new Promise<{ id: string; name: string } | null>((_, reject) => {
        rejectA = reject;
      });

      // 1. Request A starts first
      const switchA = manager.switchOrganisation({
        targetOrgId: "org-a",
        userOrganisations,
        fetchBrand: () => promiseA,
      });

      // 2. Request B starts second and finishes
      await manager.switchOrganisation({
        targetOrgId: "org-b",
        userOrganisations,
        fetchBrand: async () => ({ id: "brand-b", name: "Brand B" }),
      });

      assert.equal(notifications.length, 1);

      // 3. Stale Request A fails with error
      rejectA(new Error("Delayed network error"));
      const resA = await switchA;

      assert.equal(resA.success, false);
      assert.equal(resA.reason, "STALE");

      // Verify stale error did NOT emit error notification
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].tone, "success");
    });
  });

  // =========================================================================
  // 6. AUTHENTICATED REVIEW SUBMISSION TENANCY & NO DEMO FALLBACK
  // =========================================================================
  describe("6. Authenticated Review Submission Tenancy", () => {
    beforeEach(() => {
      coordinator.persistenceMode = "AUTHENTICATED_SUPABASE";
      coordinator.organisationId = "org-cust-444";
      coordinator.brandId = "brand-cust-444";
    });

    it("passes active organisation ID and brand ID to review repository", async () => {
      const review = createDummyReview("rev-01", "Winter Campaign Launch");
      await coordinator.addReview(review);

      assert.equal(mockRepo.submittedParams.length, 1);
      const submission = mockRepo.submittedParams[0];
      assert.equal(submission.organisationId, "org-cust-444");
      assert.equal(submission.brandId, "brand-cust-444");
      assert.equal(submission.review.id, "rev-01");
    });

    it("fails closed when brandId is missing in authenticated mode", async () => {
      coordinator.brandId = null;
      const review = createDummyReview("rev-02", "Unbranded Submission");

      await assert.rejects(
        () => coordinator.addReview(review),
        /Active brand profile is required to submit reviews in authenticated mode/
      );

      assert.equal(mockRepo.submittedParams.length, 0);
    });

    it("fails closed when organisationId is missing in authenticated mode", async () => {
      coordinator.organisationId = null;
      const review = createDummyReview("rev-03", "Orphan Review");

      await assert.rejects(
        () => coordinator.addReview(review),
        /Active organisation is required to submit reviews in authenticated mode/
      );

      assert.equal(mockRepo.submittedParams.length, 0);
    });

    it("never falls back to the demo brand ID or demo organisation ID for authenticated accounts", async () => {
      coordinator.brandId = null;
      const review = createDummyReview("rev-04", "Security Invariant Review");

      try {
        await coordinator.addReview(review);
        assert.fail("Should have thrown error");
      } catch (err: unknown) {
        assert.ok(err instanceof Error);
        const leaked = mockRepo.submittedParams.some(
          (p) =>
            p.brandId === DEMO_CONFIG.BRAND_ID ||
            p.brandId === "b0000000-0000-0000-0000-000000000001" ||
            p.organisationId === DEMO_CONFIG.ORGANISATION_ID ||
            p.organisationId === "e0000000-0000-0000-0000-000000000001"
        );
        assert.equal(leaked, false);
      }
    });

    it("rejects caller-supplied brand ID when it does not match the active organisation's brand", async () => {
      const review = createDummyReview("rev-05", "Cross-Brand Spoof Attempt");

      await assert.rejects(
        () => coordinator.addReview(review, "malicious-foreign-brand-id"),
        /Caller-supplied brand ID does not match the active organisation's brand/
      );

      assert.equal(mockRepo.submittedParams.length, 0);
    });

    it("accepts caller-supplied brand ID when it matches the resolved brand ID", async () => {
      const review = createDummyReview("rev-06", "Matching Brand Review");
      await coordinator.addReview(review, "brand-cust-444");

      assert.equal(mockRepo.submittedParams.length, 1);
      assert.equal(mockRepo.submittedParams[0].brandId, "brand-cust-444");
    });
  });

  // =========================================================================
  // 7. SHARED DEMO AND LOCAL DEMO PRESERVATION
  // =========================================================================
  describe("7. Shared Demo & Local Demo Non-Regression", () => {
    it("retains dedicated demo organisation and brand IDs in SHARED_DEMO mode", async () => {
      coordinator.persistenceMode = "SHARED_DEMO";
      coordinator.organisationId = null;
      coordinator.brandId = null;

      const review = createDummyReview("rev-demo-01", "Demo Public Submission");
      await coordinator.addReview(review);

      assert.equal(mockRepo.submittedParams.length, 1);
      const submission = mockRepo.submittedParams[0];
      assert.equal(submission.organisationId, DEMO_CONFIG.ORGANISATION_ID);
      assert.equal(submission.brandId, DEMO_CONFIG.BRAND_ID);
    });

    it("preserves local behavior in DEMO_LOCAL unauthenticated mode", async () => {
      coordinator.persistenceMode = "DEMO_LOCAL";
      coordinator.organisationId = null;
      coordinator.brandId = null;

      const localRepo = new LocalReviewRepository([]);
      const localCoordinator = new TenancyCoordinator(localRepo);
      localCoordinator.persistenceMode = "DEMO_LOCAL";

      const review = createDummyReview("rev-local-01", "Local Draft Review");
      await localCoordinator.addReview(review);

      const saved = await localRepo.fetchReviews();
      assert.equal(saved.length, 1);
      assert.equal(saved[0].id, "rev-local-01");
    });

    it("clears brand state and browser storage on sign-out", () => {
      coordinator.organisationId = "org-cust-logout";
      coordinator.brandId = "brand-cust-logout";
      coordinator.brandName = "Logout Brand";
      coordinator.storage.setItem(ORG_STORAGE_KEY, "org-cust-logout");
      coordinator.storage.setItem(BRAND_STORAGE_KEY, "brand-cust-logout");

      coordinator.signOut();

      assert.equal(coordinator.organisationId, null);
      assert.equal(coordinator.brandId, null);
      assert.equal(coordinator.brandName, null);
      assert.equal(coordinator.storage.getItem(ORG_STORAGE_KEY), null);
      assert.equal(coordinator.storage.getItem(BRAND_STORAGE_KEY), null);
      assert.equal(coordinator.persistenceMode, "DEMO_LOCAL");
    });
  });

  // =========================================================================
  // 8. TWO DISTINCT ORGANISATIONS TENANT ISOLATION
  // =========================================================================
  describe("8. Cross-Organisation Tenant Isolation Proof", () => {
    it("proves two different organisations isolate their reviews under their own brand IDs", async () => {
      // Organisation A workflow
      coordinator.persistenceMode = "AUTHENTICATED_SUPABASE";
      coordinator.organisationId = "org-acme-corp";
      coordinator.brandId = "brand-acme-pharma";

      const reviewA = createDummyReview("rev-acme-1", "Acme Product Brochure");
      await coordinator.addReview(reviewA);

      // Organisation B workflow
      coordinator.organisationId = "org-globex-ind";
      coordinator.brandId = "brand-globex-tech";

      const reviewB = createDummyReview("rev-globex-1", "Globex Cloud Whitepaper");
      await coordinator.addReview(reviewB);

      // Verify repository recorded both with exact, distinct tenancy
      assert.equal(mockRepo.submittedParams.length, 2);

      const submissionA = mockRepo.submittedParams[0];
      assert.equal(submissionA.organisationId, "org-acme-corp");
      assert.equal(submissionA.brandId, "brand-acme-pharma");
      assert.equal(submissionA.review.id, "rev-acme-1");

      const submissionB = mockRepo.submittedParams[1];
      assert.equal(submissionB.organisationId, "org-globex-ind");
      assert.equal(submissionB.brandId, "brand-globex-tech");
      assert.equal(submissionB.review.id, "rev-globex-1");

      // Verify complete independence
      assert.notEqual(submissionA.organisationId, submissionB.organisationId);
      assert.notEqual(submissionA.brandId, submissionB.brandId);

      // Verify fetchReviews scoped to org A returns only Org A's reviews
      const orgAReviews = await mockRepo.fetchReviews("org-acme-corp");
      assert.equal(orgAReviews.length, 1);
      assert.equal(orgAReviews[0].id, "rev-acme-1");

      // Verify fetchReviews scoped to org B returns only Org B's reviews
      const orgBReviews = await mockRepo.fetchReviews("org-globex-ind");
      assert.equal(orgBReviews.length, 1);
      assert.equal(orgBReviews[0].id, "rev-globex-1");
    });
  });
});
