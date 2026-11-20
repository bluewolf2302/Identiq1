import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  HostedPersistenceUnavailableError,
  getPersistenceEnvironmentInfo,
} from "@/lib/brand-context";
import { getSupabaseServerConfig } from "@/lib/supabase/server";

export interface GuidelineStoragePutInput {
  organisationId: string;
  brandId: string;
  documentId: string;
  versionLabel: string;
  buffer: Buffer;
}

export interface GuidelineStoragePutResult {
  storageKey: string;
  storageBackend: "supabase" | "local_file";
  bucket?: string;
}

export interface GuidelinePdfStorage {
  readonly backend: "supabase" | "local_file";
  putPdf(input: GuidelineStoragePutInput): Promise<GuidelineStoragePutResult>;
  getPdf(storageKey: string): Promise<Buffer>;
  deletePdf(storageKey: string): Promise<void>;
}

export class GuidelineStorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GuidelineStorageError";
  }
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned.slice(0, 100) || fallback;
}

export function buildGuidelineStorageKey(input: {
  organisationId: string;
  brandId: string;
  documentId: string;
  versionLabel: string;
}): string {
  const org = sanitizeSegment(input.organisationId, "org");
  const brand = sanitizeSegment(input.brandId, "brand");
  const doc = sanitizeSegment(input.documentId, "doc");
  const ver = sanitizeSegment(input.versionLabel, "v1");
  return `${org}/${brand}/${doc}/${ver}.pdf`;
}

function validateStorageKey(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.includes("\0") ||
    !/^[a-zA-Z0-9._/-]+\.pdf$/i.test(normalized)
  ) {
    throw new GuidelineStorageError("Invalid guideline PDF storage key.");
  }
  return normalized;
}

function getLocalStorageRoot(): string {
  const custom = process.env.IDENTIQ_GUIDELINE_FILES_DIR?.trim();
  return custom
    ? path.resolve(custom)
    : path.resolve(process.cwd(), ".identiq-data", "guideline-files");
}

function resolveConfinedLocalPath(baseDir: string, storageKey: string): string {
  const safeKey = validateStorageKey(storageKey);
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, safeKey);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new GuidelineStorageError(
      "Attempted guideline file path outside configured storage directory.",
    );
  }
  return resolvedTarget;
}

class LocalFileGuidelinePdfStorage implements GuidelinePdfStorage {
  readonly backend = "local_file" as const;

  private get baseDir(): string {
    return getLocalStorageRoot();
  }

  async putPdf(
    input: GuidelineStoragePutInput,
  ): Promise<GuidelineStoragePutResult> {
    const storageKey = buildGuidelineStorageKey(input);
    const targetPath = resolveConfinedLocalPath(this.baseDir, storageKey);
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${targetPath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, input.buffer);
    await fs.rename(tempPath, targetPath);
    return {
      storageKey,
      storageBackend: "local_file",
    };
  }

  async getPdf(storageKey: string): Promise<Buffer> {
    const targetPath = resolveConfinedLocalPath(this.baseDir, storageKey);
    try {
      return await fs.readFile(targetPath);
    } catch (error) {
      throw new GuidelineStorageError(
        `Guideline PDF could not be read from local storage (${storageKey}).`,
        error,
      );
    }
  }

  async deletePdf(storageKey: string): Promise<void> {
    const targetPath = resolveConfinedLocalPath(this.baseDir, storageKey);
    await fs.rm(targetPath, { force: true }).catch(() => undefined);
  }
}

class SupabaseGuidelinePdfStorage implements GuidelinePdfStorage {
  readonly backend = "supabase" as const;

  private get bucket(): string {
    return process.env.SUPABASE_GUIDELINES_BUCKET?.trim() || "identiq-guidelines";
  }

  private getRequiredConfig() {
    const config = getSupabaseServerConfig();
    if (!config.configured || !config.supabaseUrl || !config.serviceRoleKey) {
      throw new HostedPersistenceUnavailableError(
        "Supabase Storage service-role credentials are missing for private guideline PDF storage.",
      );
    }
    return {
      supabaseUrl: config.supabaseUrl.replace(/\/+$/, ""),
      serviceRoleKey: config.serviceRoleKey,
    };
  }

  private async ensurePrivateBucket(
    supabaseUrl: string,
    serviceRoleKey: string,
  ): Promise<void> {
    await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: this.bucket,
        name: this.bucket,
        public: false,
        file_size_limit: 20 * 1024 * 1024,
        allowed_mime_types: ["application/pdf"],
      }),
    }).catch(() => undefined);
  }

  async putPdf(
    input: GuidelineStoragePutInput,
  ): Promise<GuidelineStoragePutResult> {
    const { supabaseUrl, serviceRoleKey } = this.getRequiredConfig();
    const storageKey = validateStorageKey(buildGuidelineStorageKey(input));
    const encodedKey = storageKey
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encodedKey}`;

    const upload = async () =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/pdf",
          "x-upsert": "true",
        },
        body: new Uint8Array(input.buffer),
      });

    let res = await upload();
    if (!res.ok && (res.status === 400 || res.status === 404)) {
      await this.ensurePrivateBucket(supabaseUrl, serviceRoleKey);
      res = await upload();
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GuidelineStorageError(
        `Failed to store guideline PDF in private bucket "${this.bucket}" (${res.status}): ${detail.slice(0, 200)}`,
      );
    }

    return {
      storageKey,
      storageBackend: "supabase",
      bucket: this.bucket,
    };
  }

  async getPdf(storageKey: string): Promise<Buffer> {
    const { supabaseUrl, serviceRoleKey } = this.getRequiredConfig();
    const safeKey = validateStorageKey(storageKey);
    const encodedKey = safeKey
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const endpoint = `${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucket)}/${encodedKey}`;

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new GuidelineStorageError(
        `Guideline PDF could not be retrieved from private storage (${res.status}).`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deletePdf(storageKey: string): Promise<void> {
    const { supabaseUrl, serviceRoleKey } = this.getRequiredConfig();
    const safeKey = validateStorageKey(storageKey);
    const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}`;
    await fetch(endpoint, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: [safeKey] }),
    }).catch(() => undefined);
  }
}

export function createGuidelinePdfStorage(): GuidelinePdfStorage {
  const info = getPersistenceEnvironmentInfo();
  if (info.backend === "supabase") {
    return new SupabaseGuidelinePdfStorage();
  }
  if (info.backend === "unavailable") {
    throw new HostedPersistenceUnavailableError(info.reason);
  }
  return new LocalFileGuidelinePdfStorage();
}
