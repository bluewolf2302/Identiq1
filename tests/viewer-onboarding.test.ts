import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AVATAR_PRESETS,
  createDefaultViewerProfile,
  FALLBACK_VIEWER_NAME,
  getInitials,
  isSafeCustomAvatarDataUrl,
  loadViewerProfile,
  MAX_CUSTOM_AVATAR_BYTES,
  normalizeViewerRole,
  parseStoredViewerProfile,
  PRESET_AVATAR_IDS,
  resolveActiveActorIdentity,
  saveViewerProfile,
  validateAvatarUpload,
  validateViewerName,
  VIEWER_PROFILE_STORAGE_KEY,
} from "../lib/viewer-profile";

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test("first visit defaults to onboarding incomplete with obsidian preset", () => {
  const emptyStorage = createMemoryStorage();
  const profile = loadViewerProfile(emptyStorage);

  assert.equal(profile.onboardingCompleted, false);
  assert.equal(profile.guidedTourCompleted, false);
  assert.equal(profile.name, "");
  assert.equal(profile.avatarId, "obsidian");
  assert.equal(PRESET_AVATAR_IDS.length, 6);
  assert.ok(AVATAR_PRESETS[profile.avatarId]);
});

test("name validation rejects empty, whitespace-only, too short, and overly long names", () => {
  assert.equal(validateViewerName("").valid, false);
  assert.equal(validateViewerName("   \t\n  ").valid, false);
  assert.equal(validateViewerName("A").valid, false);
  assert.equal(validateViewerName("X".repeat(51)).valid, false);

  const valid = validateViewerName("  Aarav   Mehta  ");
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized, "Aarav Mehta");
});

test("role normalization and initials handle single, multi-word, and empty inputs", () => {
  assert.equal(normalizeViewerRole("   "), "Brand Reviewer");
  assert.equal(normalizeViewerRole("  Creative   Director "), "Creative Director");
  assert.equal(getInitials("Aarav Mehta"), "AM");
  assert.equal(getInitials("Priya"), "PR");
  assert.equal(getInitials("   "), "IQ");
});

test("avatar upload validation enforces MIME types, non-empty files, and 512 KB cap", () => {
  assert.equal(validateAvatarUpload({ type: "image/png", size: 1024 }).valid, true);
  assert.equal(validateAvatarUpload({ type: "image/jpeg", size: 2048 }).valid, true);
  assert.equal(validateAvatarUpload({ type: "image/webp", size: 4096 }).valid, true);

  assert.equal(validateAvatarUpload({ type: "image/svg+xml", size: 500 }).valid, false);
  assert.equal(validateAvatarUpload({ type: "application/pdf", size: 500 }).valid, false);
  assert.equal(validateAvatarUpload({ type: "image/png", size: 0 }).valid, false);
  assert.equal(
    validateAvatarUpload({ type: "image/png", size: MAX_CUSTOM_AVATAR_BYTES + 1 }).valid,
    false,
  );
});

test("isSafeCustomAvatarDataUrl rejects SVG/script payloads and accepts valid raster base64 URLs", () => {
  assert.equal(
    isSafeCustomAvatarDataUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
    true,
  );
  assert.equal(
    isSafeCustomAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"),
    false,
  );
  assert.equal(isSafeCustomAvatarDataUrl("javascript:alert(1)"), false);
  assert.equal(isSafeCustomAvatarDataUrl(undefined), false);
});

test("corrupt or incomplete stored profile recovers cleanly to default onboarding state", () => {
  assert.deepEqual(parseStoredViewerProfile("{not-valid-json"), createDefaultViewerProfile());
  assert.deepEqual(
    parseStoredViewerProfile(JSON.stringify({ name: "Test", onboardingCompleted: false })),
    createDefaultViewerProfile(),
  );
  assert.deepEqual(
    parseStoredViewerProfile(
      JSON.stringify({
        name: " ",
        role: "Reviewer",
        avatarId: "mint",
        onboardingCompleted: true,
        guidedTourCompleted: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ),
    createDefaultViewerProfile(),
  );
});

test("saving and reloading viewer profile persists across visits and sanitizes bad custom image URLs", () => {
  const storage = createMemoryStorage();
  const saved = saveViewerProfile(
    {
      name: "Neha Kapoor",
      role: "Senior Brand Lead",
      avatarId: "mint",
      customAvatarDataUrl: "data:image/png;base64,AAAA",
      onboardingCompleted: true,
      guidedTourCompleted: true,
      updatedAt: "2026-11-15T00:00:00.000Z",
    },
    storage,
  );
  assert.equal(saved, true);

  const reloaded = loadViewerProfile(storage);
  assert.equal(reloaded.onboardingCompleted, true);
  assert.equal(reloaded.guidedTourCompleted, true);
  assert.equal(reloaded.name, "Neha Kapoor");
  assert.equal(reloaded.role, "Senior Brand Lead");
  assert.equal(reloaded.avatarId, "mint");
  assert.equal(reloaded.customAvatarDataUrl, "data:image/png;base64,AAAA");

  // Simulate tampered customAvatarDataUrl in storage
  storage.setItem(
    VIEWER_PROFILE_STORAGE_KEY,
    JSON.stringify({
      ...reloaded,
      customAvatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
    }),
  );
  const sanitized = loadViewerProfile(storage);
  assert.equal(sanitized.name, "Neha Kapoor");
  assert.equal(sanitized.customAvatarDataUrl, undefined);
});

test("saveViewerProfile fails gracefully if storage throws quota errors", () => {
  const throwingStorage = {
    length: 0,
    clear() {},
    getItem() {
      throw new Error("denied");
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {
      throw new Error("QuotaExceededError");
    },
  } satisfies Storage;

  assert.equal(saveViewerProfile(createDefaultViewerProfile(), throwingStorage), false);
  assert.deepEqual(loadViewerProfile(throwingStorage), createDefaultViewerProfile());
});

test("resolveActiveActorIdentity uses onboarded viewer identity and never leaks Maya Lin fallback", () => {
  const unboarded = resolveActiveActorIdentity({
    viewerProfile: createDefaultViewerProfile(),
    authUser: null,
  });
  assert.equal(unboarded.name, FALLBACK_VIEWER_NAME);
  assert.notEqual(unboarded.name, "Maya Lin");

  const onboarded = resolveActiveActorIdentity({
    viewerProfile: {
      name: "Rohan Verma",
      role: "Compliance Director",
      avatarId: "lavender",
      onboardingCompleted: true,
      guidedTourCompleted: false,
      updatedAt: "2026-11-15T00:00:00.000Z",
    },
    authUser: null,
  });
  assert.equal(onboarded.name, "Rohan Verma");
  assert.equal(onboarded.role, "Compliance Director");

  const authenticated = resolveActiveActorIdentity({
    viewerProfile: {
      name: "Local Name",
      role: "Local Role",
      avatarId: "sky",
      onboardingCompleted: true,
      guidedTourCompleted: true,
      updatedAt: "2026-11-15T00:00:00.000Z",
    },
    authUser: {
      email: "sara@company.com",
      user_metadata: { full_name: "Sara Khan", role: "Brand Admin" },
    },
  });
  assert.equal(authenticated.name, "Sara Khan");
  assert.equal(authenticated.role, "Brand Admin");
});

test("user-facing UI files contain no hardcoded Maya Lin, stock avatar image, or infrastructure jargon", () => {
  const uiFiles = [
    "app/page.tsx",
    "app/settings/page.tsx",
    "app/login/page.tsx",
    "app/reviews/new/page.tsx",
    "app/studio/page.tsx",
    "app/reports/page.tsx",
    "components/AppShell.tsx",
    "components/GuidelinePdfReviewPanel.tsx",
    "components/reports/ReviewDossierReportView.tsx",
    "components/reports/AuditTraceabilityReportView.tsx",
    "components/onboarding/LandingView.tsx",
    "components/onboarding/OnboardingView.tsx",
    "components/onboarding/GuidedTourModal.tsx",
  ];

  const bannedUiPatterns: Array<{ label: string; regex: RegExp }> = [
    { label: "avatar_brand_lead.jpg", regex: /avatar_brand_lead\.jpg/ },
    { label: "Maya Lin", regex: /\bMaya Lin\b/ },
    { label: "Hosted Database", regex: /\bHosted Database\b/ },
    { label: "In-Memory", regex: /\bIn-Memory\b/ },
    { label: "RLS", regex: /\bRLS\b/ },
    { label: "OpenRouter", regex: /\bOpenRouter\b/ },
    { label: "Gemini", regex: /\bGemini\b/ },
    { label: "Phase 4 Operational", regex: /\bPhase 4 Operational\b/ },
    { label: "RFC 4180", regex: /\bRFC 4180\b/ },
    { label: "API credentials", regex: /\bAPI credentials\b/ },
  ];

  for (const relPath of uiFiles) {
    const absPath = path.join(process.cwd(), relPath);
    const content = fs.readFileSync(absPath, "utf8");
    for (const pattern of bannedUiPatterns) {
      assert.equal(
        pattern.regex.test(content),
        false,
        `Unexpected UI string "${pattern.label}" found in ${relPath}`,
      );
    }
  }

  // Verify SVG favicon exists and legacy favicon.ico is removed
  assert.equal(fs.existsSync(path.join(process.cwd(), "app/icon.svg")), true);
  assert.equal(fs.existsSync(path.join(process.cwd(), "app/favicon.ico")), false);
});
