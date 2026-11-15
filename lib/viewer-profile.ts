import { z } from "zod";

export const VIEWER_PROFILE_STORAGE_KEY = "identiq_viewer_profile_v1";

export const PRESET_AVATAR_IDS = [
  "obsidian",
  "mint",
  "lavender",
  "peach",
  "sky",
  "rose",
] as const;

export type PresetAvatarId = (typeof PRESET_AVATAR_IDS)[number];

export interface AvatarPresetMeta {
  id: PresetAvatarId;
  label: string;
  bgHex: string;
  fgHex: string;
  accentHex: string;
  ringHex: string;
}

export const AVATAR_PRESETS: Record<PresetAvatarId, AvatarPresetMeta> = {
  obsidian: {
    id: "obsidian",
    label: "Charcoal",
    bgHex: "#141414",
    fgHex: "#FAF8F6",
    accentHex: "#CDEEE0",
    ringHex: "#2E2E32",
  },
  mint: {
    id: "mint",
    label: "Botanical Mint",
    bgHex: "#CDEEE0",
    fgHex: "#14532D",
    accentHex: "#141414",
    ringHex: "#9BD5BC",
  },
  lavender: {
    id: "lavender",
    label: "Lavender",
    bgHex: "#E2DBFB",
    fgHex: "#3E326E",
    accentHex: "#141414",
    ringHex: "#C4B7F4",
  },
  peach: {
    id: "peach",
    label: "Warm Peach",
    bgHex: "#F9DEC0",
    fgHex: "#7C2D12",
    accentHex: "#141414",
    ringHex: "#E8BF93",
  },
  sky: {
    id: "sky",
    label: "Sky Blue",
    bgHex: "#DDF0FA",
    fgHex: "#1E3A8A",
    accentHex: "#141414",
    ringHex: "#B5DAF0",
  },
  rose: {
    id: "rose",
    label: "Soft Rose",
    bgHex: "#F6D5DA",
    fgHex: "#7F1D1D",
    accentHex: "#141414",
    ringHex: "#E4B2BA",
  },
};

export const DEFAULT_VIEWER_ROLE = "Brand Reviewer";
export const FALLBACK_VIEWER_NAME = "Brand Reviewer";
export const MAX_CUSTOM_AVATAR_BYTES = 512 * 1024; // 512 KB
export const ALLOWED_AVATAR_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const ViewerProfileSchema = z.object({
  name: z.string(),
  role: z.string(),
  avatarId: z.enum(PRESET_AVATAR_IDS),
  customAvatarDataUrl: z.string().optional(),
  onboardingCompleted: z.boolean(),
  guidedTourCompleted: z.boolean(),
  updatedAt: z.string(),
});

export type ViewerProfile = z.infer<typeof ViewerProfileSchema>;

export function createDefaultViewerProfile(): ViewerProfile {
  return {
    name: "",
    role: DEFAULT_VIEWER_ROLE,
    avatarId: "obsidian",
    customAvatarDataUrl: undefined,
    onboardingCompleted: false,
    guidedTourCompleted: false,
    updatedAt: "",
  };
}

export function validateViewerName(rawName: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = rawName.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      valid: false,
      normalized: "",
      error: "Please enter your name to continue.",
    };
  }
  if (normalized.length < 2) {
    return {
      valid: false,
      normalized,
      error: "Name must be at least 2 characters.",
    };
  }
  if (normalized.length > 50) {
    return {
      valid: false,
      normalized,
      error: "Name must be 50 characters or fewer.",
    };
  }
  return { valid: true, normalized };
}

export function normalizeViewerRole(rawRole?: string): string {
  const trimmed = (rawRole ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_VIEWER_ROLE;
  return trimmed.slice(0, 60);
}

export function isSafeCustomAvatarDataUrl(url?: string): boolean {
  if (!url) return false;
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
}

export function validateAvatarUpload(file: {
  type: string;
  size: number;
  name?: string;
}): { valid: boolean; error?: string } {
  const normalizedType = file.type.toLowerCase();
  if (
    !ALLOWED_AVATAR_MIME_TYPES.includes(
      normalizedType as (typeof ALLOWED_AVATAR_MIME_TYPES)[number],
    )
  ) {
    return {
      valid: false,
      error: "Please choose a PNG, JPG, or WEBP image.",
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: "The selected image file is empty.",
    };
  }
  if (file.size > MAX_CUSTOM_AVATAR_BYTES) {
    return {
      valid: false,
      error: "Avatar image must be 512 KB or smaller.",
    };
  }
  return { valid: true };
}

export function getInitials(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return "IQ";
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function parseStoredViewerProfile(raw: string | null): ViewerProfile {
  if (!raw) return createDefaultViewerProfile();
  try {
    const parsedJson = JSON.parse(raw);
    const parsed = ViewerProfileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return createDefaultViewerProfile();
    }

    const nameCheck = validateViewerName(parsed.data.name);
    if (!parsed.data.onboardingCompleted || !nameCheck.valid) {
      return createDefaultViewerProfile();
    }

    const customAvatarDataUrl = isSafeCustomAvatarDataUrl(
      parsed.data.customAvatarDataUrl,
    )
      ? parsed.data.customAvatarDataUrl
      : undefined;

    return {
      name: nameCheck.normalized,
      role: normalizeViewerRole(parsed.data.role),
      avatarId: parsed.data.avatarId,
      customAvatarDataUrl,
      onboardingCompleted: true,
      guidedTourCompleted: Boolean(parsed.data.guidedTourCompleted),
      updatedAt: parsed.data.updatedAt || "",
    };
  } catch {
    return createDefaultViewerProfile();
  }
}

function getBrowserStorage(override?: Storage | null): Storage | null {
  if (override !== undefined) return override;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadViewerProfile(storageOverride?: Storage | null): ViewerProfile {
  const storage = getBrowserStorage(storageOverride);
  if (!storage) return createDefaultViewerProfile();
  try {
    return parseStoredViewerProfile(storage.getItem(VIEWER_PROFILE_STORAGE_KEY));
  } catch {
    return createDefaultViewerProfile();
  }
}

export function saveViewerProfile(
  profile: ViewerProfile,
  storageOverride?: Storage | null,
): boolean {
  const storage = getBrowserStorage(storageOverride);
  if (!storage) return false;
  try {
    storage.setItem(VIEWER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function resolveActiveActorIdentity(input: {
  viewerProfile: ViewerProfile;
  authUser?: {
    email?: string | null;
    user_metadata?: { full_name?: string; role?: string } | null;
  } | null;
}): { name: string; role: string } {
  if (input.authUser) {
    const authName =
      input.authUser.user_metadata?.full_name?.trim() ||
      input.authUser.email?.split("@")[0]?.trim() ||
      input.viewerProfile.name.trim() ||
      FALLBACK_VIEWER_NAME;
    const authRole =
      input.authUser.user_metadata?.role?.trim() ||
      input.viewerProfile.role ||
      DEFAULT_VIEWER_ROLE;
    return { name: authName, role: authRole };
  }

  const viewerName = validateViewerName(input.viewerProfile.name);
  return {
    name: viewerName.valid ? viewerName.normalized : FALLBACK_VIEWER_NAME,
    role: normalizeViewerRole(input.viewerProfile.role),
  };
}
